import { z } from 'zod';
import { BudgetSchema, IsoDateTime, UsageSchema } from './common.js';
import { type Plan, StepDraftSchema } from './plan.js';

export const RunStatusSchema = z.enum([
  'queued',
  'planning',
  'awaiting_plan_confirmation',
  'executing',
  'replanning',
  'awaiting_approval',
  'awaiting_user',
  'finalizing',
  'succeeded',
  'failed',
  'cancelled',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'succeeded',
  'failed',
  'cancelled',
]);

export const RunModeSchema = z.enum(['auto', 'plan_first']);
export type RunMode = z.infer<typeof RunModeSchema>;

export const RunSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  status: RunStatusSchema,
  input: z.string(),
  mode: RunModeSchema,
  model: z.string().optional(),
  currentRevision: z.number().int().nonnegative(),
  budget: BudgetSchema,
  usage: UsageSchema,
  finalAnswer: z.string().optional(),
  error: z.string().optional(),
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.optional(),
  endedAt: IsoDateTime.optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const ThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  activeRunId: z.string().nullable().optional(),
});
export type Thread = z.infer<typeof ThreadSchema>;

export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'denied']);
export const ApprovalSchema = z.object({
  id: z.string(),
  runId: z.string(),
  stepId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  reason: z.string().optional(),
  status: ApprovalStatusSchema,
  resolution: z.string().optional(),
  createdAt: IsoDateTime,
  resolvedAt: IsoDateTime.optional(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const UserQuestionSchema = z.object({
  id: z.string(),
  runId: z.string(),
  stepId: z.string(),
  question: z.string(),
  options: z.array(z.string()).optional(),
  answer: z.string().optional(),
  createdAt: IsoDateTime,
  answeredAt: IsoDateTime.optional(),
});
export type UserQuestion = z.infer<typeof UserQuestionSchema>;

export const ArtifactSchema = z.object({
  id: z.string(),
  runId: z.string(),
  stepId: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  createdAt: IsoDateTime,
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export interface ToolCallRecord {
  stepId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  isError?: boolean;
  durationMs?: number;
  state: 'calling' | 'done';
}

/** Point-in-time projection of a run, as served by GET /api/runs/:id. */
export interface RunSnapshot {
  run: Run;
  plan: Plan | null;
  approvals: Approval[];
  questions: UserQuestion[];
  toolCalls: ToolCallRecord[];
  lastSeq: number;
}

/** User decision when a run waits for plan confirmation (mode = plan_first). */
export const PlanConfirmationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm') }),
  z.object({
    action: z.literal('edit'),
    steps: z.array(StepDraftSchema).min(1),
    objective: z.string().optional(),
  }),
  z.object({ action: z.literal('cancel'), reason: z.string().optional() }),
]);
export type PlanConfirmation = z.infer<typeof PlanConfirmationSchema>;

export const ApprovalResponseSchema = z.object({
  approved: z.boolean(),
  reason: z.string().optional(),
});
export type ApprovalResponse = z.infer<typeof ApprovalResponseSchema>;

export const QuestionAnswerSchema = z.object({ answer: z.string().min(1) });

/** Request body for starting a run in a thread. */
export const SendMessageRequestSchema = z.object({
  messages: z.array(z.unknown()).optional(),
  text: z.string().optional(),
  mode: RunModeSchema.optional(),
  model: z.string().optional(),
  toolPolicy: z
    .object({
      autoApprove: z.boolean().optional(),
    })
    .optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const UpdateThreadRequestSchema = z.object({
  title: z.string().trim().min(1).max(80),
});
export type UpdateThreadRequest = z.infer<typeof UpdateThreadRequestSchema>;
