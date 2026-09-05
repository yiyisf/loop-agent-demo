import { z } from 'zod';

export const IsoDateTime = z.string();

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  llmCalls: z.number().int().nonnegative().default(0),
  toolCalls: z.number().int().nonnegative().default(0),
});
export type Usage = z.infer<typeof UsageSchema>;

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  llmCalls: 0,
  toolCalls: 0,
});

export const addUsage = (a: Usage, b: Partial<Usage>): Usage => ({
  inputTokens: a.inputTokens + (b.inputTokens ?? 0),
  outputTokens: a.outputTokens + (b.outputTokens ?? 0),
  totalTokens: a.totalTokens + (b.totalTokens ?? 0),
  llmCalls: a.llmCalls + (b.llmCalls ?? 0),
  toolCalls: a.toolCalls + (b.toolCalls ?? 0),
});

export const BudgetSchema = z.object({
  maxSteps: z.number().int().positive().default(12),
  maxToolCallsPerStep: z.number().int().positive().default(8),
  maxAttemptsPerStep: z.number().int().positive().default(2),
  maxReplans: z.number().int().nonnegative().default(3),
  maxParallel: z.number().int().positive().default(2),
  maxTotalTokens: z.number().int().positive().default(300_000),
  maxDurationMs: z
    .number()
    .int()
    .positive()
    .default(15 * 60_000),
});
export type Budget = z.infer<typeof BudgetSchema>;

export const defaultBudget = (): Budget => BudgetSchema.parse({});
