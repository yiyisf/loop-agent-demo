/**
 * Root `pnpm dev`: start API then Vite, without nesting another pnpm.
 * See scripts/run-pkg.mjs for why `pnpm --filter` hangs on Windows.
 */
import { spawnPackage, stopChild } from './run-pkg.mjs';

const target = (
  process.env.VITE_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? '3001'}`
).replace(/\/$/, '');
const health = `${target}/health`;
const timeoutMs = Number(process.env.API_WAIT_MS ?? 90_000);

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) stopChild(child);
  process.exit(code);
}

function track(child, name) {
  children.push(child);
  child.on('error', (err) => {
    console.error(`[dev] ${name} failed to start:`, err);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    console.error(`[dev] ${name} exited (${reason})`);
    shutdown(code ?? 1);
  });
}

async function waitForApi() {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'not started';
  let logged = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(health, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    if (!logged) {
      console.log(`[dev] waiting for API at ${health} …`);
      logged = true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`API did not become ready at ${health} (${lastErr})`);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] starting server (tsx watch, cwd=apps/server)');
track(spawnPackage('server'), 'server');

try {
  await waitForApi();
} catch (err) {
  console.error(`[dev] ${err instanceof Error ? err.message : err}`);
  shutdown(1);
}

console.log('[dev] API ready, starting web (vite, cwd=apps/web)');
track(spawnPackage('web'), 'web');
