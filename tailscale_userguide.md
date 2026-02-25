# Tailscale Remote Access Guide for ClaudeCodeUI

This guide explains how to access ClaudeCodeUI from your phone through Tailscale.

## 1. Prerequisites

- ClaudeCodeUI server is running on this Mac (default: `http://127.0.0.1:3001`)
- Tailscale app is installed and logged in on:
  - this Mac
  - your phone

## 2. Recommended Access URL

Use the Tailscale HTTPS URL:

- `https://hank-office.tail98ddca.ts.net`

Fallback (tailnet only):

- `http://100.88.129.51:3001`

## 3. Verify Tailscale Status

Run on your Mac:

```bash
tailscale status
tailscale serve status
```

Expected:

- node is `online`
- `serve` maps `https://<your-node>.ts.net` to local `3001`

## 4. Configure / Reconfigure Serve

Expose local ClaudeCodeUI on tailnet HTTPS:

```bash
tailscale serve --bg 3001
```

Check config:

```bash
tailscale serve status --json
```

Reset serve config if needed:

```bash
tailscale serve reset
```

Then re-apply:

```bash
tailscale serve --bg 3001
```

## 5. Start ClaudeCodeUI

From project root:

```bash
npm run server
```

Keep this process running while using remote access.

## 6. Security Notes

- Keep access within your tailnet (do not enable Funnel unless you explicitly want public internet exposure).
- Use a strong `JWT_SECRET` in `.env`.
- Keep `ALLOW_LEGACY_QUERY_TOKEN=false`.
- Prefer HTTPS Tailscale URL over raw IP when possible.

## 7. Quick Troubleshooting

If phone cannot open UI:

1. Confirm phone Tailscale is connected.
2. Confirm Mac is online in `tailscale status`.
3. Confirm server is up:
   ```bash
   curl http://127.0.0.1:3001/health
   ```
4. Confirm Tailscale path is working:
   ```bash
   curl https://hank-office.tail98ddca.ts.net/health
   ```

If step 4 fails but step 3 works, run:

```bash
tailscale serve reset
tailscale serve --bg 3001
```
