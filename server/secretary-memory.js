/**
 * Secretary memory bridge — AI Secretary Phase 9 (方案 B, per-message).
 *
 * Isolated on purpose: claude-sdk.js only calls the three exports below, so the
 * upstream-merge diff in claude-sdk.js stays tiny and re-appliable (see
 * services/secretary/context/codeweb-fork-hygiene-notes.md). Everything here is
 * a NO-OP unless the chat is happening inside the secretary's chat workspace,
 * so every other code_web project is completely untouched.
 *
 * It shells out to the secretary's own CLI (single source of truth for memory
 * routing / recall / embeddings), never re-implementing memory logic in JS:
 *   - recallBlock(utterance) -> `run-once.sh recall-block --query <utterance>`
 *       prints the persona+recalled-memory block we feed to systemPrompt.append,
 *       recalled fresh for THIS message.
 *
 * This is READ-ONLY. The write side is batched: a secretary ritual
 * (`chat_consolidation`) periodically reads these sessions' transcripts (which
 * the Agent SDK already logs under ~/.claude/projects/) and consolidates them
 * into memory — fuller context + dedup + far fewer LLM calls than per-turn.
 */

import { spawn } from 'child_process';
import path from 'path';

const SECRETARY_DIR =
  process.env.SECRETARY_DIR ||
  '/Users/hank/Workspace/hank/ai_auto/services/secretary';
const RUN_ONCE = path.join(SECRETARY_DIR, 'bin', 'run-once.sh');
const CHAT_WORKSPACE =
  process.env.SECRETARY_CHAT_WORKSPACE ||
  path.join(SECRETARY_DIR, 'state', 'chat_workspace');

const RECALL_TIMEOUT_MS = parseInt(process.env.SECRETARY_RECALL_TIMEOUT_MS, 10) || 20000;

/**
 * True only when the chat's working directory is the secretary chat workspace.
 * Used to gate every hook so other projects are never affected.
 */
export function isSecretaryWorkspace(cwd) {
  if (!cwd) return false;
  try {
    return path.resolve(cwd) === path.resolve(CHAT_WORKSPACE);
  } catch {
    return false;
  }
}

/**
 * Spawn the secretary run-once.sh with argv (no shell → no injection risk).
 * Resolves to stdout (when capture) or null; never rejects — a memory hiccup
 * must not break the chat.
 */
function runOnce(args, { capture = false, timeoutMs = RECALL_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child;
    const timer = setTimeout(() => {
      try { child?.kill('SIGKILL'); } catch { /* ignore */ }
      console.warn(`[secretary-memory] ${args[0]} timed out after ${timeoutMs}ms`);
      done(capture ? '' : null);
    }, timeoutMs);
    try {
      child = spawn(RUN_ONCE, args, { cwd: SECRETARY_DIR });
    } catch (err) {
      console.warn('[secretary-memory] spawn failed:', err?.message);
      return done(capture ? '' : null);
    }
    if (capture) child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => process.stderr.write(`[secretary-memory] ${d}`));
    child.on('error', (err) => {
      console.warn('[secretary-memory] child error:', err?.message);
      done(capture ? '' : null);
    });
    child.on('close', () => done(capture ? out : null));
  });
}

/**
 * 方案 B read hook: recall memory relevant to THIS utterance and return the
 * systemPrompt.append text (persona + recalled memory). Empty string on any
 * failure so the caller simply skips injection (方案 A CLAUDE.md still applies).
 */
export async function recallBlock(utterance) {
  const block = await runOnce(['recall-block', '--query', utterance || ''], {
    capture: true,
    timeoutMs: RECALL_TIMEOUT_MS,
  });
  return (block || '').trim();
}
