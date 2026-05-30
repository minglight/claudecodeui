# MERGE-UPSTREAM - pulling upstream releases into this fork

Model: this fork should stay as `upstream release tag + small security layer`.

Current aligned baseline:

- upstream release: `v1.32.0`
- local alignment branch: `align/v1.32.0`
- current security commit: `77afe9a`
- current patch export: `security-patches/0001-fix-security-harden-auth-cors-and-command-execution.patch`

Do not push or fast-forward `codex/security-hardening` without Hank's explicit approval.

## Remotes

```bash
git remote -v
# origin    git@github.com-minglight:minglight/claudecodeui.git
# upstream  https://github.com/siteboon/claudecodeui.git
```

If `upstream` is missing:

```bash
git remote add upstream https://github.com/siteboon/claudecodeui.git
```

## Repeatable SOP

### 1. Pick the target release

```bash
git fetch upstream --tags
git tag -l 'v*' --sort=-v:refname | head
TARGET=v1.33.0
git status
```

The worktree must be clean before starting.

### 2. Create an alignment branch

```bash
git switch -c align/$TARGET $TARGET
```

### 3. Replay or re-derive the security layer

Try the current patch first:

```bash
git am --3way security-patches/0001-fix-security-harden-auth-cors-and-command-execution.patch
```

If the patch conflicts, do not skip any security item. Resolve by re-deriving the affected protection in the new upstream
structure. The common conflict map:

| Item | Current home | Re-derive by checking |
|---|---|---|
| JWT/cookie/query-token/platform bypass | `server/middleware/auth.js`, `server/routes/auth.js` | Token signing/verifying, cookie set/clear, query-token rejection, platform key gate |
| WebSocket platform/auth | `server/modules/websocket/services/websocket-auth.service.ts` | `authenticateWebSocket(request)` receives the request, not just a URL token |
| CORS | `server/index.js` | `corsOptions` allowlist, `credentials:true`, `exposedHeaders:['X-Refreshed-Token']` |
| PTY env | `server/modules/websocket/services/shell-websocket.service.ts` | `buildPtyEnvironment()` does not spread `process.env` |
| Project/file path guard | project DB services + `server/index.js` | project creation stays under `WORKSPACES_ROOT`; file ops stay under project root |
| Slash commands | `server/routes/commands.js` | shell lines escape `$ARGUMENTS` / `$1...` |
| Git endpoints | `server/routes/git.js` | arg-array spawn, no shell strings, strict branch/ref/path validation |

### 4. Verify

```bash
npm ci
npm run typecheck
npm run build
```

Boot checks:

```bash
env -u JWT_SECRET npm run server
env JWT_SECRET=claude-ui-dev-secret-change-in-production npm run server
env JWT_SECRET=<strong-test-secret> SERVER_PORT=3199 npm run server
curl http://127.0.0.1:3199/health
```

Expected:

- no `JWT_SECRET` fails at boot
- insecure default fails at boot
- strong secret boots and `/health` returns 200

Security smoke checklist:

- [ ] New token has an `exp` claim and HS256 is pinned.
- [ ] Login/register set an httpOnly auth cookie; logout clears it.
- [ ] `?token=...` is rejected unless `ALLOW_LEGACY_QUERY_TOKEN=true`.
- [ ] Platform mode without `x-platform-bypass-key` is rejected.
- [ ] Unknown CORS origins do not receive `Access-Control-Allow-Origin`; allowed origins do.
- [ ] PTY shell env does not include arbitrary server env.
- [ ] File/project paths cannot escape the project/workspace root.
- [ ] Shell command arguments are escaped.
- [ ] Git branch/ref/file inputs cannot become options or traversal paths.

### 5. Export the new patch

After the security commit exists:

```bash
git format-patch -1 HEAD -o security-patches
```

Update `FORK-STATUS.md` and `security-patches/SECURITY-PATCHES.md` with the new commit SHA and any re-homed files.

### 6. Land after approval

Only after verification and Hank approval:

```bash
git switch codex/security-hardening
git merge --ff-only align/$TARGET
git tag fork-$TARGET
```

Push is a separate approval:

```bash
git push origin codex/security-hardening
git push origin fork-$TARGET
```

## Cadence

Prefer smaller release hops. The old jump from `v1.20.1` to `v1.32.0` required re-deriving several security items because
upstream had rewritten auth, websocket, project, and git surfaces.
