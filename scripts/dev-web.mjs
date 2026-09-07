/**
 * Start Vite only after the API answers /health.
 * On Windows, tsx's first compile + libsql load can take several seconds;
 * if Vite proxies before listen, the page shows 502 Bad Gateway.
 */
import { spawn } from 'node:child_process';

const target = (process.env.VITE_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const health = `${target}/health`;
const timeoutMs = Number(process.env.API_WAIT_MS ?? 90_000);

async function waitForApi() {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'not started';
  let logged = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(health);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    if (!logged) {
      console.log(`[web] waiting for API at ${health} …`);
      logged = true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.error(
    `[web] API did not become ready at ${health} (${lastErr}).\n` +
      'Look at the [server] lines above. On Windows: pnpm rebuild libsql',
  );
  process.exit(1);
}

await waitForApi();
const child = spawn('pnpm', ['--filter', '@loop-agent/web', 'dev'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
