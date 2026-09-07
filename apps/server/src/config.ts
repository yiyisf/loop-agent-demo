import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  /**
   * Bind address. IPv4 loopback works on Windows, macOS, and Linux, and avoids
   * the Windows firewall prompt that `0.0.0.0` triggers. Docker sets `0.0.0.0`.
   */
  HOST: z.string().min(1).default('127.0.0.1'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  /** Filesystem path, `file:...` URL, or `memory` for an in-process store. */
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
 * Resolve DATABASE_URL to a filesystem path for `node:sqlite`.
 * Returns `null` for the in-memory store. Accepts `memory`, `:memory:`,
 * `file:./relative.db`, WHATWG `file:///...`, and raw OS paths (including `C:\...`).
 */
export function resolveSqlitePath(url: string, cwd = process.cwd()): string | null {
  const trimmed = url.trim();
  if (trimmed === 'memory' || trimmed === ':memory:' || trimmed.startsWith('file::memory:')) {
    return null;
  }
  const raw = trimmed.startsWith('file:') ? trimmed.slice('file:'.length) : trimmed;
  if (raw.startsWith(':memory:')) return null;

  if (raw.startsWith('//')) {
    try {
      return fileURLToPath(trimmed.startsWith('file:') ? trimmed : `file:${raw}`);
    } catch {
      const withoutSlashes = raw.replace(/^\/+/, '');
      if (/^[A-Za-z]:[\\/]/.test(withoutSlashes)) return withoutSlashes;
    }
  }
  if (/^[A-Za-z]:[\\/]/.test(raw)) return raw;
  if (path.isAbsolute(raw) || raw.startsWith('/')) return raw;
  return path.resolve(cwd, raw);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(emptyToUndefined(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
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
