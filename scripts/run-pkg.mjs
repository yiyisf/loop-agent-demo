/**
 * Start a workspace package's dev CLI with `node` directly.
 *
 * Root `pnpm dev` must not spawn another `pnpm --filter …` — nested pnpm
 * deadlocks the server on Windows (tsx never listens on :3001). Running
 * from `apps/server` itself is fine; this helper matches that cwd + argv.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGES = {
  server: {
    dir: path.join(root, 'apps', 'server'),
    dep: 'tsx',
    cliFromDep: 'dist/cli.mjs',
    args: ['watch', '--clear-screen=false', 'src/index.ts'],
  },
  web: {
    dir: path.join(root, 'apps', 'web'),
    dep: 'vite',
    cliFromDep: 'bin/vite.js',
    args: [],
  },
};

function resolveCli(pkgDir, dep, cliFromDep) {
  const require = createRequire(path.join(pkgDir, 'package.json'));
  let depRoot;
  try {
    depRoot = path.dirname(require.resolve(`${dep}/package.json`));
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot resolve ${dep} from ${pkgDir}. Run \`pnpm install\` at the repo root.\n${why}`,
    );
  }
  return path.join(depRoot, cliFromDep);
}

export function stopChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  child.kill('SIGTERM');
}

/**
 * @param {'server' | 'web'} kind
 * @param {string[]} extraArgs
 * @returns {import('node:child_process').ChildProcess}
 */
export function spawnPackage(kind, extraArgs = []) {
  const spec = PACKAGES[kind];
  if (!spec) {
    console.error(`Usage: node scripts/run-pkg.mjs <server|web> [args…]`);
    process.exit(1);
  }
  const cli = resolveCli(spec.dir, spec.dep, spec.cliFromDep);
  const args = [...spec.args, ...extraArgs];
  return spawn(process.execPath, [cli, ...args], {
    cwd: spec.dir,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
}

function isEntrypoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isEntrypoint()) {
  const child = spawnPackage(process.argv[2], process.argv.slice(3));
  const onSignal = () => stopChild(child);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
  child.on('error', (err) => {
    console.error(`[${process.argv[2] ?? 'pkg'}] failed to start:`, err);
    process.exit(1);
  });
}
