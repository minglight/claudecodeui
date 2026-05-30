# Security Patches - rationale & re-apply guide

This fork carries a deliberate security-hardening layer over upstream `siteboon/claudecodeui`.
Do not drop any item below during an upstream merge without understanding the "why".

## Patch Artifacts

| File | Contents | Use |
|---|---|---|
| `0001-fix-security-harden-auth-cors-and-command-execution.patch` | Current aligned patch, exported from `77afe9a` on upstream `v1.32.0` | Use this as the current authoritative patch export |
| `0001-security-harden-auth-cors-and-command-execution.patch` | Legacy patch, exported from old commit `708454b` over the `v1.20.1`-era base | Historical reference for why the fork diverged |
| `0002-local-wip-session-and-chat-robustness.patch` | Old uncommitted WIP snapshot from the original checkout | Historical reference; relevant pieces were folded into `77afe9a` or superseded upstream |

Authoritative current branch state: `align/v1.32.0` at `77afe9a`.

## Hardening Items

### 1. No insecure JWT secret

**Files:** `server/middleware/auth.js`, `.env.example`

`JWT_SECRET` is required at boot, and the known insecure default value is rejected.

**Why:** a fixed or missing signing key makes token forgery possible.

### 2. Token expiry + HS256 algorithm pinning

**File:** `server/middleware/auth.js`

Tokens use `JWT_EXPIRES_IN` (default `30d` in this fork) and both sign/verify pin HS256.

**Why:** expiry limits leaked-token lifetime; algorithm pinning blocks `alg:none` / confusion attacks.

### 3. httpOnly cookie auth

**Files:** `server/middleware/auth.js`, `server/routes/auth.js`, `src/utils/api.js`

Register/login set an httpOnly cookie; logout clears it; frontend fetches include credentials.

**Why:** the auth token is no longer only JS-readable localStorage state, reducing XSS exfiltration impact.

### 4. Query-token auth disabled by default

**File:** `server/middleware/auth.js`

Query-string tokens are ignored unless `ALLOW_LEGACY_QUERY_TOKEN=true`; disabled query tokens return 401.

**Why:** tokens in URLs leak into logs, proxy traces, browser history, and Referer headers.

### 5. Platform bypass requires an explicit key

**Files:** `server/middleware/auth.js`, `server/modules/websocket/services/websocket-auth.service.ts`

Platform bypass is active only with `PLATFORM_BYPASS_AUTH=true` and a matching `x-platform-bypass-key`.

**Why:** the old platform mode implicitly authenticated as the first DB user.

### 6. CORS allowlist

**File:** `server/index.js`

Only default local origins plus `CORS_ALLOWED_ORIGINS` receive `Access-Control-Allow-Origin`; credentials are enabled.

**Why:** credentialed cookie auth must not be paired with open CORS.

### 7. PTY environment allowlist

**File:** `server/modules/websocket/services/shell-websocket.service.ts`

Shell PTYs receive only a small allowlist of environment variables plus terminal color vars.

**Why:** the full server environment can contain API keys, tokens, or other secrets.

### 8. Project path traversal guard

**Files:** `server/shared/utils.ts`, `server/modules/projects/services/project-management.service.ts`, `server/index.js`

v1.32.0 had already moved project identity to DB-backed project IDs and validates project creation under
`WORKSPACES_ROOT`. This patch keeps old `server/projects.js` removed and tightens file-operation path checks in
`server/index.js`.

**Why:** crafted project/file paths must not escape the registered project root.

### 9. Slash-command argument escaping

**File:** `server/routes/commands.js`

Arguments substituted into shell command lines (`!cmd`) are single-quote escaped.

**Why:** raw `$ARGUMENTS` / `$1` substitution can become shell command injection.

### 10. Git route hardening

**File:** `server/routes/git.js`

Git still runs through arg-array `spawn` with `shell:false`; branch/ref/file validators reject option-like args and path
traversal.

**Why:** branch names and file paths must not become git option injection or filesystem traversal.

## Regenerate Current Patch

```bash
git format-patch -1 77afe9a -o security-patches
```

For a future upstream release, create `align/<target>`, replay or re-derive the security layer, then rerun the checklist
in `MERGE-UPSTREAM.md`.
