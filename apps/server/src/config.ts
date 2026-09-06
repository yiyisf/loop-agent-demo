import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
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
