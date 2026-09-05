import type { Usage } from './schema/common.js';
import type { Plan, PlanDiff, Step } from './schema/plan.js';
import type { Approval, RunStatus, UserQuestion } from './schema/run.js';

/**
 * Custom `data-*` parts streamed to the UI (AI SDK UI Message Stream).
 * Keys map to chunk types `data-<key>`.
 */
export type LoopAgentDataParts = {
  /** Latest run status; single part with id "run", reconciled on update. */
  run: {
    runId: string;
    threadId: string;
    status: RunStatus;
    reason?: string;
    seq: number;
    startedAt?: string;
    endedAt?: string;
    error?: string;
  };
  /** Current plan; single part with id "plan". */
  plan: {
    plan: Plan;
    diff?: PlanDiff;
    reason?: string;
  };
  /** One part per step, id `step:<stepId>`. */
  step: Step;
  /** Transient per-step process text (not persisted in message history). */
  'step-log': {
    stepId: string;
    kind: 'text' | 'reasoning';
    delta: string;
  };
  /** Tool call/result, id `tool:<toolCallId>`. */
  tool: {
    stepId: string;
    toolCallId: string;
    toolName: string;
    input: unknown;
    output?: unknown;
    isError?: boolean;
    durationMs?: number;
    state: 'calling' | 'done';
  };
  /** Approval request, id `approval:<approvalId>`. */
  approval: Approval;
  /** Question to the user, id `question:<questionId>`. */
  question: UserQuestion;
  /** Aggregated usage, id "usage". */
  usage: Usage;
  /** Non-fatal notice for the UI (transient). */
  notice: {
    level: 'info' | 'warn' | 'error';
    message: string;
  };
};

export type LoopAgentDataPartType = `data-${keyof LoopAgentDataParts & string}`;

export interface LoopAgentMessageMetadata {
  runId?: string;
  threadId?: string;
  model?: string;
  createdAt?: string;
}

export const dataPartIds = {
  run: 'run',
  plan: 'plan',
  usage: 'usage',
  step: (stepId: string) => `step:${stepId}`,
  tool: (toolCallId: string) => `tool:${toolCallId}`,
  approval: (approvalId: string) => `approval:${approvalId}`,
  question: (questionId: string) => `question:${questionId}`,
} as const;

/** Response headers used by the streaming endpoints. */
export const RUN_ID_HEADER = 'x-run-id';
export const THREAD_ID_HEADER = 'x-thread-id';
