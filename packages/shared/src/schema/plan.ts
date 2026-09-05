import { z } from 'zod';
import { IsoDateTime, UsageSchema } from './common.js';

export const StepStatusSchema = z.enum([
  'pending',
  'ready',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'blocked',
  'cancelled',
  'waiting_approval',
  'waiting_user',
]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const TERMINAL_STEP_STATUSES: ReadonlySet<StepStatus> = new Set([
  'succeeded',
  'failed',
  'skipped',
  'blocked',
  'cancelled',
]);

/** Result reported by the executor when a step finishes. */
export const StepResultSchema = z.object({
  status: z.enum(['succeeded', 'failed']),
  summary: z
    .string()
    .describe('Concise summary of what was achieved, for downstream steps and the final answer.'),
  output: z.unknown().optional().describe('Optional structured output of the step.'),
  artifacts: z.array(z.string()).default([]).describe('Artifact ids produced by this step.'),
});
export type StepResult = z.infer<typeof StepResultSchema>;

/** The part of a step the planner is allowed to author. */
export const StepDraftSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/)
    .describe('Short stable identifier, e.g. "collect-candidates".'),
  title: z.string().min(1).max(80),
  goal: z.string().min(1).describe('What this step must accomplish.'),
  dependsOn: z.array(z.string()).default([]).describe('Ids of steps that must succeed first.'),
  tools: z.array(z.string()).default([]).describe('Tool names this step may use.'),
  acceptance: z.string().min(1).describe('How to verify the step succeeded.'),
});
export type StepDraft = z.infer<typeof StepDraftSchema>;

export const StepSchema = StepDraftSchema.extend({
  status: StepStatusSchema,
  attempt: z.number().int().nonnegative().default(0),
  revisionIntroduced: z.number().int().positive().default(1),
  result: StepResultSchema.optional(),
  error: z.string().optional(),
  usage: UsageSchema.optional(),
  startedAt: IsoDateTime.optional(),
  endedAt: IsoDateTime.optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const PLAN_MAX_STEPS = 12;

/** What the planner returns. Runtime fields are filled in by the server. */
export const PlanDraftSchema = z.object({
  objective: z.string().min(1).describe('Restatement of the user task in one or two sentences.'),
  steps: z.array(StepDraftSchema).min(1).max(PLAN_MAX_STEPS),
  rationale: z.string().optional().describe('Why the plan is structured this way.'),
});
export type PlanDraft = z.infer<typeof PlanDraftSchema>;

export const PlanSchema = z.object({
  runId: z.string(),
  revision: z.number().int().positive(),
  objective: z.string(),
  steps: z.array(StepSchema).min(1),
  rationale: z.string().optional(),
  createdAt: IsoDateTime,
});
export type Plan = z.infer<typeof PlanSchema>;

export const PlanDiffSchema = z.object({
  added: z.array(z.string()),
  updated: z.array(z.string()),
  removed: z.array(z.string()),
});
export type PlanDiff = z.infer<typeof PlanDiffSchema>;

export const PlanPatchOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add'),
    step: StepDraftSchema,
  }),
  z.object({
    op: z.literal('update'),
    stepId: z.string(),
    changes: StepDraftSchema.omit({ id: true }).partial(),
  }),
  z.object({
    op: z.literal('remove'),
    stepId: z.string(),
  }),
]);
export type PlanPatchOp = z.infer<typeof PlanPatchOpSchema>;

export const ReflectionDecisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('continue'),
    note: z.string().optional(),
  }),
  z.object({
    action: z.literal('replan'),
    reason: z.string(),
    patch: z.array(PlanPatchOpSchema).min(1),
  }),
  z.object({
    action: z.literal('ask_user'),
    question: z.string(),
    options: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal('finish_early'),
    reason: z.string(),
  }),
]);
export type ReflectionDecision = z.infer<typeof ReflectionDecisionSchema>;
