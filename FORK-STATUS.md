# Fork Status - `minglight/claudecodeui`

Inventory and alignment notes for Hank's fork of upstream `siteboon/claudecodeui`.
Companion docs:

- [`MERGE-UPSTREAM.md`](./MERGE-UPSTREAM.md) - repeatable upstream-release merge SOP.
- [`security-patches/SECURITY-PATCHES.md`](./security-patches/SECURITY-PATCHES.md) - security patch rationale and patch artifacts.

Generated/updated 2026-05-30 for secretary task `370ea6b8-e378-81c6-b444-c9fd41714c91`.

## Current Result

The fork is now aligned on a dedicated local worktree branch:

| Item | Value |
|---|---|
| Target release | upstream `v1.32.0` (`10f721c`) |
| Alignment branch | `align/v1.32.0` |
| Security commit | `77afe9a` `fix(security): harden auth, cors, and command execution` |
| Push status | Not pushed |

`codex/security-hardening` in the original checkout remains untouched at the old security commit `708454b`; the safe
next step is to review `align/v1.32.0`, then fast-forward or PR it only after Hank's explicit push/landing approval.

## Remotes

| Remote | URL | Role |
|---|---|---|
| `origin` | `git@github.com-minglight:minglight/claudecodeui.git` | Hank's fork. Do not push without approval. |
| `upstream` | `https://github.com/siteboon/claudecodeui.git` | Original project / release source. |

Latest verified release on 2026-05-30: `v1.32.0`. Upstream `main` was ahead at `38bf21d`, but this alignment targets the
stable release tag, not main HEAD.

## What Changed In The Alignment

The original security layer was one commit on an old `v1.20.1`-era base:

- old security commit: `708454b` `security: harden auth, cors, and command execution`
- old base: `23801e9`
- upstream gap to `v1.32.0`: 153 commits

Direct replay was intentionally not accepted blindly. The v1.32.0 tree had rewritten or relocated the sensitive host
areas, so the security layer was re-derived into the new structure:

| Security item | v1.32.0 home | Result |
|---|---|---|
| JWT required, insecure default rejected, expiry, HS256 pin | `server/middleware/auth.js` | Re-derived and verified |
| httpOnly cookie auth + logout clear | `server/middleware/auth.js`, `server/routes/auth.js`, `src/utils/api.js` | Re-derived and verified |
| Query-token auth disabled by default | `server/middleware/auth.js` | Re-derived and verified |
| Platform bypass key gate | `server/middleware/auth.js`, `server/modules/websocket/services/websocket-auth.service.ts` | Re-derived and verified for missing key |
| CORS allowlist | `server/index.js` | Re-derived; unknown origins receive no ACAO header |
| PTY env allowlist | `server/modules/websocket/services/shell-websocket.service.ts` | Re-homed from old `server/index.js` |
| Project path traversal guard | v1.32.0 project DB + `validateWorkspacePath`; file ops in `server/index.js` | Re-derived; old `server/projects.js` stays removed |
| Slash-command arg escaping | `server/routes/commands.js` | Re-derived |
| Git arg/path hardening | `server/routes/git.js` | Re-derived with arg-array spawn, stricter branch/ref/path validation |
| Local UX robustness | `src/contexts/WebSocketContext.tsx`, `src/utils/api.js` | Folded where still relevant; old chat permission WIP is covered by upstream normalized events |

## Patch Artifacts

`security-patches/0001-fix-security-harden-auth-cors-and-command-execution.patch` is the current v1.32.0 patch export
from `77afe9a`.

Legacy/reference artifacts are kept because they explain the old fork delta:

- `security-patches/0001-security-harden-auth-cors-and-command-execution.patch` - original `708454b` patch over the old base.
- `security-patches/0002-local-wip-session-and-chat-robustness.patch` - old uncommitted local WIP snapshot from the original checkout.

## Verification

Passed on `align/v1.32.0`:

- `npm ci`
- `npm run typecheck`
- `npm run build`
- `npm run server` with a temporary `JWT_SECRET` and local verification DB; `/health` returned 200.
- Server refused to boot with no `JWT_SECRET`.
- Server refused to boot with the insecure default JWT secret.
- Register/login issued an httpOnly SameSite=Lax auth cookie and a token with `exp`.
- Bearer auth for `/api/auth/user` returned 200.
- `?token=...` on a protected route returned 401 with legacy query tokens disabled.
- Logout cleared the auth cookie.
- Disallowed CORS origin returned no `Access-Control-Allow-Origin`; allowed localhost origin returned the header.
- Platform mode with bypass enabled but no `x-platform-bypass-key` returned 401.

Known non-blocking observations:

- `npm ci` reported 40 dependency audit findings from the upstream dependency set.
- Vite emitted existing CSS/chunk-size warnings, but build exited 0.

## Ops Note

The original checkout has an untracked `com.minglight.claudecodeui.plist` pointing at
`/Users/hank/Workspace/hank/code_web/claudecodeui`, which does not exist here. That launchd path issue is machine ops,
not part of this fork-hygiene patch, and was not included.
