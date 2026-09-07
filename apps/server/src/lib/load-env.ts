import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Parse a dotenv file. Quotes, `export`, and comments are supported; interpolation is not. */
export function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const line = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Walk from `startDir` toward the filesystem root, collecting `.env` paths (nearest first). */
export function findDotEnvFiles(startDir = process.cwd(), maxDepth = 4): string[] {
  const files: string[] = [];
  let dir = path.resolve(startDir);
  for (let i = 0; i <= maxDepth; i++) {
    const candidate = path.join(dir, '.env');
    if (existsSync(candidate)) files.push(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return files;
}

/**
 * Load `.env` files from cwd up to the repo root.
 * Already-set `process.env` keys always win; closer files override farther ones.
 */
export function loadDotEnv(
  startDir = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const predefined = new Set(Object.keys(env));
  const loaded: string[] = [];
  for (const file of findDotEnvFiles(startDir).reverse()) {
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    loaded.push(file);
    for (const [key, value] of Object.entries(parseDotEnv(content))) {
      if (!predefined.has(key)) env[key] = value;
    }
  }
  return loaded;
}
