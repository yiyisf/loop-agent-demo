import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DATABASE_URL: z.string().default('file:./data/loop-agent.db'),
  DATA_DIR: z.string().default('./data'),

  LLM_PROVIDER: z.enum(['openai', 'openai-compatible', 'anthropic', 'mock']).default('mock'),
  LLM_BASE_URL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('gpt-4.1'),
  LLM_PLANNER_MODEL: z.string().optional(),
  LLM_EXECUTOR_MODEL: z.string().optional(),
  LLM_MODELS: z.string().optional(),

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
