import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  /**
   * Bind address. `127.0.0.1` avoids the Windows firewall prompt that `0.0.0.0`
   * triggers; set `0.0.0.0` in Docker so the published port is reachable.
   */
  HOST: z.string().min(1).default('127.0.0.1'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  /** libsql URL (`file:...`) or `memory` for an in-process store. */
  DATABASE_URL: z.string().default('file:./data/loop-agent.db'),
  DATA_DIR: z.string().default('./data'),
  /** When set, the built web app in this directory is served on the same origin. */
  STATIC_DIR: z.string().optional(),

  LLM_PROVIDER: z.enum(['openai', 'openai-compatible', 'anthropic', 'mock']).default('mock'),
  LLM_BASE_URL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('gpt-4.1'),
  LLM_PLANNER_MODEL: z.string().optional(),
  LLM_EXECUTOR_MODEL: z.string().optional(),
  LLM_MODELS: z.string().optional(),
  /** Extra latency per mock model call (demo pacing when LLM_PROVIDER=mock). */
  MOCK_DELAY_MS: z.coerce.number().int().nonnegative().default(0),

  SEARCH_PROVIDER: z.enum(['tavily', 'exa', 'brave', 'none']).default('none'),
  SEARCH_API_KEY: z.string().optional(),

  BUDGET_MAX_REPLANS: z.coerce.number().int().nonnegative().default(3),
  BUDGET_MAX_PARALLEL: z.coerce.number().int().positive().default(2),
  BUDGET_MAX_DURATION_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60_000),
  BUDGET_MAX_TOTAL_TOKENS: z.coerce.number().int().positive().default(300_000),
  BUDGET_MAX_STEPS: z.coerce.number().int().positive().max(30).default(12),
  /**
   * Consult the LLM reflector after every successful step (one extra call per step).
   * Off by default: confident successes use the rule-based reflector (ADR D8).
   */
  REFLECT_ON_SUCCESS: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  OTEL_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

const emptyToUndefined = (env: NodeJS.ProcessEnv) =>
  Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === '' ? undefined : v]));

/**
 * libsql only accepts WHATWG `file:` URLs or relative `file:./x.db` paths.
 * `file:C:\foo\bar.db` (what `path.resolve` produces on Windows) is rejected
 * and the API process exits before it can listen — Vite then returns 502.
 */
export function toLibsqlFileUrl(fsPath: string): string {
  const normalized = fsPath.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${normalized}`;
  if (normalized.startsWith('/')) return `file://${normalized}`;
  return pathToFileURL(path.resolve(fsPath)).href;
}

/** Resolve `file:./relative.db` (and Windows `file:C:\...`) to a libsql-safe URL. */
export function resolveDatabaseUrl(url: string, cwd = process.cwd()): string {
  if (!url.startsWith('file:')) return url;
  const rest = url.slice('file:'.length);
  if (rest.startsWith(':memory:')) return url;
  if (rest.startsWith('//')) return url;

  if (/^[A-Za-z]:[\\/]/.test(rest)) return toLibsqlFileUrl(rest);
  if (rest.startsWith('/')) return toLibsqlFileUrl(rest);

  return toLibsqlFileUrl(path.resolve(cwd, rest));
}

/** Filesystem path for a `file:` libsql URL, or `undefined` for memory URLs. */
export function sqliteFilePathFromUrl(url: string): string | undefined {
  if (!url.startsWith('file:')) return undefined;
  const rest = url.slice('file:'.length);
  if (rest.startsWith(':memory:')) return undefined;
  if (rest.startsWith('//') || rest.startsWith('/')) {
    try {
      return fileURLToPath(url.startsWith('file://') ? url : `file://${rest}`);
    } catch {
      return path.resolve(rest);
    }
  }
  if (/^[A-Za-z]:[\\/]/.test(rest)) return rest;
  return path.resolve(rest);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(emptyToUndefined(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return { ...parsed.data, DATABASE_URL: resolveDatabaseUrl(parsed.data.DATABASE_URL) };
}

/** Models offered to the UI: LLM_MODELS (comma separated) or the default model. */
export function availableModels(config: AppConfig): string[] {
  const list = (config.LLM_MODELS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const set = new Set([config.LLM_MODEL, ...list]);
  return [...set];
}
