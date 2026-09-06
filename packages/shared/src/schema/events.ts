import { z } from 'zod';
import { IsoDateTime, UsageSchema } from './common.js';
import {
  PlanDiffSchema,
  PlanSchema,
  ReflectionDecisionSchema,
  StepResultSchema,
  StepStatusSchema,
} from './plan.js';
import { RunStatusSchema } from './run.js';

export const RunEventPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('run.status'),
    status: RunStatusSchema,
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal('plan.created'), plan: PlanSchema }),
  z.object({
    type: z.literal('plan.revised'),
    plan: PlanSchema,
    diff: PlanDiffSchema,
    reason: z.string(),
  }),
  z.object({
    type: z.literal('step.status'),
    stepId: z.string(),
    status: StepStatusSchema,
    attempt: z.number().int(),
    error: z.string().optional(),
  }),
  z.object({ type: z.literal('step.result'), stepId: z.string(), result: StepResultSchema }),
  z.object({ type: z.literal('step.text_delta'), stepId: z.string(), delta: z.string() }),
  z.object({ type: z.literal('step.reasoning_delta'), stepId: z.string(), delta: z.string() }),
  z.object({
    type: z.literal('tool.call'),
    stepId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal('tool.result'),
    stepId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    output: z.unknown(),
    isError: z.boolean().default(false),
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal('approval.requested'),
    approvalId: z.string(),
    stepId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('approval.resolved'),
    approvalId: z.string(),
    approved: z.boolean(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('user_question.asked'),
    questionId: z.string(),
    stepId: z.string(),
    question: z.string(),
    options: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('user_question.answered'),
    questionId: z.string(),
    answer: z.string(),
  }),
  z.object({
    type: z.literal('reflection'),
    stepId: z.string(),
    decision: ReflectionDecisionSchema,
  }),
  z.object({ type: z.literal('final.text_delta'), delta: z.string() }),
  z.object({ type: z.literal('final.done'), answer: z.string() }),
  z.object({ type: z.literal('usage'), usage: UsageSchema }),
  z.object({
    type: z.literal('log'),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    stepId: z.string().optional(),
    fatal: z.boolean(),
  }),
]);
export type RunEventPayload = z.infer<typeof RunEventPayloadSchema>;
export type RunEventType = RunEventPayload['type'];

export const RunEventEnvelopeSchema = z.object({
  runId: z.string(),
  seq: z.number().int().nonnegative(),
  ts: IsoDateTime,
});

export const RunEventSchema = z.intersection(RunEventPayloadSchema, RunEventEnvelopeSchema);
export type RunEvent = RunEventPayload & z.infer<typeof RunEventEnvelopeSchema>;

/** High-frequency events kept only in memory (never persisted). */
export const TRANSIENT_EVENT_TYPES: ReadonlySet<RunEventType> = new Set([
  'step.text_delta',
  'step.reasoning_delta',
  'final.text_delta',
]);
