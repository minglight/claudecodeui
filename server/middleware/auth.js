import jwt from 'jsonwebtoken';
import { userDb } from '../modules/database/index.js';
import { IS_PLATFORM } from '../constants/config.js';

const INSECURE_DEFAULT_JWT_SECRET = 'claude-ui-dev-secret-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';
const JWT_ALGORITHMS = ['HS256'];
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'cloudcli_token';
const ALLOW_LEGACY_QUERY_TOKEN = process.env.ALLOW_LEGACY_QUERY_TOKEN === 'true';
const AUTH_COOKIE_MAX_AGE_SECONDS = Number.parseInt(
  process.env.AUTH_COOKIE_MAX_AGE_SECONDS || '86400',
  10
);
const PLATFORM_BYPASS_AUTH = IS_PLATFORM && process.env.PLATFORM_BYPASS_AUTH === 'true';
const PLATFORM_BYPASS_KEY = process.env.PLATFORM_BYPASS_KEY || '';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required. Set it in your environment before starting the server.');
}

if (JWT_SECRET === INSECURE_DEFAULT_JWT_SECRET) {
  throw new Error('JWT_SECRET uses an insecure default value. Set a unique secret.');
}

if (!Number.isInteger(AUTH_COOKIE_MAX_AGE_SECONDS) || AUTH_COOKIE_MAX_AGE_SECONDS <= 0) {
  throw new Error('AUTH_COOKIE_MAX_AGE_SECONDS must be a positive integer.');
}

function parseCookies(cookieHeader = '') {
  const cookieMap = {};
  const pairs = cookieHeader.split(';');

  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex < 0) continue;
    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!key) continue;
    try {
      cookieMap[key] = decodeURIComponent(value);
    } catch {
      cookieMap[key] = value;
    }
  }

  return cookieMap;
}

function getCookieOptions() {
  const configuredSameSite = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  const sameSite = ['strict', 'lax', 'none'].includes(configuredSameSite)
    ? configuredSameSite
    : 'lax';
  const secure = process.env.COOKIE_SECURE === 'true';

  return {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS * 1000,
    path: '/',
  };
}

function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, getCookieOptions());
}

function clearAuthCookie(res) {
  const options = getCookieOptions();
  delete options.maxAge;
  res.clearCookie(AUTH_COOKIE_NAME, options);
}

function extractBearerToken(req) {
  const authHeader = req.headers?.authorization || req.headers?.['authorization'];
  return authHeader && authHeader.split(' ')[1];
}

function extractTokenFromRequest(req, { allowQueryToken = ALLOW_LEGACY_QUERY_TOKEN } = {}) {
  const bearerToken = extractBearerToken(req);
  if (bearerToken) {
    return bearerToken;
  }

  const cookies = parseCookies(req.headers?.cookie || '');
  if (cookies[AUTH_COOKIE_NAME]) {
    return cookies[AUTH_COOKIE_NAME];
  }

  const queryToken = req.query?.token;
  if (allowQueryToken && typeof queryToken === 'string') {
    return queryToken;
  }

  return null;
}

function getPlatformUser() {
  const user = userDb.getFirstUser();
  if (!user) {
    throw new Error('Platform mode: No user found in database');
  }
  return user;
}

function authenticatePlatformBypassRequest(req, res, next) {
  if (!PLATFORM_BYPASS_AUTH) {
    return false;
  }

  if (!PLATFORM_BYPASS_KEY) {
    res.status(500).json({ error: 'Platform bypass is enabled but PLATFORM_BYPASS_KEY is not configured' });
    return true;
  }

  const providedBypassKey = req.headers?.['x-platform-bypass-key'];
  if (providedBypassKey !== PLATFORM_BYPASS_KEY) {
    res.status(401).json({ error: 'Invalid platform bypass key' });
    return true;
  }

  try {
    req.user = getPlatformUser();
    next();
  } catch (error) {
    console.error('Platform mode error:', error);
    res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
  }

  return true;
}

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// JWT authentication middleware
const authenticateToken = async (req, res, next) => {
  if (authenticatePlatformBypassRequest(req, res, next)) {
    return;
  }

  const token = extractTokenFromRequest(req, { allowQueryToken: ALLOW_LEGACY_QUERY_TOKEN });
  if (!token && req.query.token && !ALLOW_LEGACY_QUERY_TOKEN) {
    return res.status(401).json({
      error: 'Access denied. Query token authentication is disabled.',
    });
  }

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: JWT_ALGORITHMS });

    // Verify user still exists and is active
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
    }

    // Auto-refresh: if token is past halfway through its lifetime, issue a new one
    if (decoded.exp && decoded.iat) {
      const now = Math.floor(Date.now() / 1000);
      const halfLife = (decoded.exp - decoded.iat) / 2;
      if (now > decoded.iat + halfLife) {
        const newToken = generateToken(user);
        setAuthCookie(res, newToken);
        res.setHeader('X-Refreshed-Token', newToken);
      }
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
      algorithm: 'HS256',
    }
  );
};

// WebSocket authentication function
const authenticateWebSocket = (req) => {
  if (PLATFORM_BYPASS_AUTH) {
    try {
      const providedBypassKey = req.headers?.['x-platform-bypass-key'];
      if (!PLATFORM_BYPASS_KEY || providedBypassKey !== PLATFORM_BYPASS_KEY) {
        return null;
      }

      const user = getPlatformUser();
      return { id: user.id, userId: user.id, username: user.username };
    } catch (error) {
      console.error('Platform mode WebSocket error:', error);
      return null;
    }
  }

  const token = extractTokenFromRequest(req, { allowQueryToken: false });
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: JWT_ALGORITHMS });
    // Verify user actually exists in database (matches REST authenticateToken behavior)
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return null;
    }
    return { userId: user.id, username: user.username };
  } catch (error) {
    console.error('WebSocket token verification error:', error);
    return null;
  }
};

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  setAuthCookie,
  clearAuthCookie,
  JWT_SECRET
};
