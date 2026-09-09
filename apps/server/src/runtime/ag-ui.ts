import {
  ApprovalResponseSchema,
  PlanConfirmationSchema,
  type RunEvent,
  type RunMode,
  TERMINAL_RUN_STATUSES,
} from '@loop-agent/shared';
import { z } from 'zod';
import { waitKeys } from './engine/hitl.js';

/** AG-UI event type names (official protocol, camelCase payloads). */
export type AgUiEventType =
  | 'RUN_STARTED'
  | 'RUN_FINISHED'
  | 'RUN_ERROR'
  | 'TEXT_MESSAGE_START'
  | 'TEXT_MESSAGE_CONTENT'
  | 'TEXT_MESSAGE_END'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_ARGS'
  | 'TOOL_CALL_END'
  | 'TOOL_CALL_RESULT'
  | 'STEP_STARTED'
  | 'STEP_FINISHED'
  | 'STATE_SNAPSHOT'
  | 'CUSTOM';

export interface AgUiInterrupt {
  id: string;
  reason: string;
  message?: string;
  toolCallId?: string;
}

export type AgUiOutcome =
  | { type: 'success' }
  | { type: 'error' }
  | { type: 'cancel' }
  | { type: 'interrupt'; interrupts: AgUiInterrupt[] };

export type AgUiEvent =
  | { type: 'RUN_STARTED'; threadId: string; runId: string }
  | {
      type: 'RUN_FINISHED';
      threadId: string;
      runId: string;
      result?: unknown;
      outcome?: AgUiOutcome;
    }
  | { type: 'RUN_ERROR'; message: string; code?: string }
  | { type: 'TEXT_MESSAGE_START'; messageId: string; role: 'assistant' }
  | { type: 'TEXT_MESSAGE_CONTENT'; messageId: string; delta: string }
  | { type: 'TEXT_MESSAGE_END'; messageId: string }
  | { type: 'TOOL_CALL_START'; toolCallId: string; toolCallName: string }
  | { type: 'TOOL_CALL_ARGS'; toolCallId: string; delta: string }
  | { type: 'TOOL_CALL_END'; toolCallId: string }
  | {
      type: 'TOOL_CALL_RESULT';
      messageId: string;
      toolCallId: string;
      content: string;
      role?: 'tool';
    }
  | { type: 'STEP_STARTED'; stepName: string }
  | { type: 'STEP_FINISHED'; stepName: string }
  | { type: 'STATE_SNAPSHOT'; snapshot: unknown }
  | { type: 'CUSTOM'; name: string; value: unknown };

export interface AgUiTranslateState {
  textStarted: boolean;
  textEnded: boolean;
  messageId: string;
  pendingInterrupts: AgUiInterrupt[];
  stepNames: Map<string, string>;
}

export function createAgUiTranslateState(runId: string): AgUiTranslateState {
  return {
    textStarted: false,
    textEnded: false,
    messageId: `msg_${runId}`,
    pendingInterrupts: [],
    stepNames: new Map(),
  };
}

const STEP_FINISHED_STATUSES = new Set(['succeeded', 'failed', 'skipped', 'cancelled', 'blocked']);

export function closeAgUiText(state: AgUiTranslateState, answer?: string): AgUiEvent[] {
  if (state.textEnded) return [];
  const out: AgUiEvent[] = [];
  if (!state.textStarted) {
    if (!answer) return [];
    state.textStarted = true;
    out.push({ type: 'TEXT_MESSAGE_START', messageId: state.messageId, role: 'assistant' });
    out.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: state.messageId, delta: answer });
  }
  state.textEnded = true;
  out.push({ type: 'TEXT_MESSAGE_END', messageId: state.messageId });
  return out;
}

function rememberSteps(state: AgUiTranslateState, steps: Array<{ id: string; title?: string }>) {
  for (const step of steps) {
    state.stepNames.set(step.id, step.title || step.id);
  }
}

function stepName(state: AgUiTranslateState, stepId: string): string {
  return state.stepNames.get(stepId) ?? stepId;
}

/** Maps one internal `RunEvent` to zero or more AG-UI events. Mutates `state`. */
export function runEventToAgUi(event: RunEvent, state: AgUiTranslateState): AgUiEvent[] {
  switch (event.type) {
    case 'final.text_delta': {
      if (!event.delta) return [];
      const out: AgUiEvent[] = [];
      if (!state.textStarted) {
        state.textStarted = true;
        out.push({ type: 'TEXT_MESSAGE_START', messageId: state.messageId, role: 'assistant' });
      }
      out.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: state.messageId, delta: event.delta });
      return out;
    }
    case 'final.done':
      return closeAgUiText(state, event.answer);
    case 'tool.call':
      return [
        { type: 'TOOL_CALL_START', toolCallId: event.toolCallId, toolCallName: event.toolName },
        {
          type: 'TOOL_CALL_ARGS',
          toolCallId: event.toolCallId,
          delta: JSON.stringify(event.input ?? {}),
        },
        { type: 'TOOL_CALL_END', toolCallId: event.toolCallId },
      ];
    case 'tool.result':
      return [
        {
          type: 'TOOL_CALL_RESULT',
          messageId: `toolmsg_${event.toolCallId}`,
          toolCallId: event.toolCallId,
          content: JSON.stringify({
            output: event.output,
            isError: event.isError,
            durationMs: event.durationMs,
          }),
          role: 'tool',
        },
      ];
    case 'step.status': {
      const name = stepName(state, event.stepId);
      if (event.status === 'running') return [{ type: 'STEP_STARTED', stepName: name }];
      if (STEP_FINISHED_STATUSES.has(event.status)) {
        return [{ type: 'STEP_FINISHED', stepName: name }];
      }
      return [];
    }
    case 'plan.created': {
      rememberSteps(state, event.plan.steps);
      return [
        { type: 'STATE_SNAPSHOT', snapshot: { plan: event.plan } },
        { type: 'CUSTOM', name: 'plan', value: { type: event.type, plan: event.plan } },
      ];
    }
    case 'plan.revised': {
      rememberSteps(state, event.plan.steps);
      return [
        { type: 'STATE_SNAPSHOT', snapshot: { plan: event.plan } },
        {
          type: 'CUSTOM',
          name: 'plan',
          value: { type: event.type, plan: event.plan, diff: event.diff, reason: event.reason },
        },
      ];
    }
    case 'ui.presented':
      return [{ type: 'CUSTOM', name: 'ui', value: event.block }];
    case 'citation.added':
      return [{ type: 'CUSTOM', name: 'citation', value: event.citation }];
    case 'artifact.created':
      return [{ type: 'CUSTOM', name: 'artifact', value: event.artifact }];
    case 'approval.requested': {
      state.pendingInterrupts.push({
        id: event.approvalId,
        reason: 'approval',
        message: event.reason ?? event.toolName,
        toolCallId: event.toolCallId,
      });
      return [{ type: 'CUSTOM', name: 'approval', value: event }];
    }
    case 'user_question.asked': {
      state.pendingInterrupts.push({
        id: event.questionId,
        reason: 'question',
        message: event.question,
      });
      return [{ type: 'CUSTOM', name: 'question', value: event }];
    }
    case 'approval.resolved':
      return [{ type: 'CUSTOM', name: 'approval.resolved', value: event }];
    case 'user_question.answered':
      return [{ type: 'CUSTOM', name: 'question.answered', value: event }];
    case 'usage':
      return [{ type: 'CUSTOM', name: 'usage', value: event.usage }];
    case 'error':
      return [
        { type: 'CUSTOM', name: 'error', value: { message: event.message, fatal: event.fatal } },
      ];
    default:
      return [];
  }
}

/** True when this event should end the current AG-UI HTTP stream (run keeps waiting). */
export function isAgUiHitlPause(event: RunEvent, state: AgUiTranslateState): boolean {
  if (event.type !== 'run.status') return false;
  if (event.status === 'awaiting_plan_confirmation') {
    if (!state.pendingInterrupts.some((i) => i.reason === 'plan_confirmation')) {
      state.pendingInterrupts.push({
        id: waitKeys.planConfirmation,
        reason: 'plan_confirmation',
        message: 'Confirm the plan before execution',
      });
    }
    return true;
  }
  if (event.status === 'awaiting_approval' || event.status === 'awaiting_user') {
    return state.pendingInterrupts.length > 0;
  }
  return false;
}

export function isAgUiTerminal(event: RunEvent): event is RunEvent & { type: 'run.status' } {
  return event.type === 'run.status' && TERMINAL_RUN_STATUSES.has(event.status);
}

const AgUiMessageSchema = z.object({
  id: z.string().optional(),
  role: z.string(),
  content: z.union([z.string(), z.array(z.unknown()), z.null()]).optional(),
  toolCallId: z.string().optional(),
  name: z.string().optional(),
});

const AgUiResumeSchema = z.object({
  interruptId: z.string().min(1),
  status: z.enum(['resolved', 'cancelled']),
  payload: z.unknown().optional(),
});

export const AgUiRunRequestSchema = z.object({
  threadId: z.string().min(1).optional(),
  runId: z.string().optional(),
  messages: z.array(AgUiMessageSchema).default([]),
  tools: z.array(z.unknown()).optional(),
  context: z.array(z.unknown()).optional(),
  forwardedProps: z.record(z.string(), z.unknown()).optional(),
  resume: z.array(AgUiResumeSchema).optional(),
  state: z.unknown().optional(),
  model: z.string().optional(),
  autoApprove: z.boolean().optional(),
  mode: z.enum(['auto', 'chat', 'plan_first']).optional(),
});

export type AgUiMessage = z.infer<typeof AgUiMessageSchema>;
export type AgUiResume = z.infer<typeof AgUiResumeSchema>;
export type AgUiRunRequest = z.infer<typeof AgUiRunRequestSchema>;

export function contentToText(content: AgUiMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      const rec = part as { type?: unknown; text?: unknown };
      if (
        typeof rec.text === 'string' &&
        (!rec.type || rec.type === 'text' || rec.type === 'input_text')
      ) {
        return rec.text;
      }
      return '';
    })
    .join('');
}

export function extractAgUiUserText(messages: AgUiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    const text = contentToText(m.content).trim();
    if (text) return text;
  }
  return '';
}

export function pickAgUiMode(body: AgUiRunRequest): RunMode {
  const raw = body.mode ?? body.forwardedProps?.mode;
  if (raw === 'chat' || raw === 'plan_first' || raw === 'auto') return raw;
  return 'auto';
}

export function pickAgUiAutoApprove(body: AgUiRunRequest): boolean {
  if (typeof body.autoApprove === 'boolean') return body.autoApprove;
  const forwarded = body.forwardedProps ?? {};
  if (typeof forwarded.autoApprove === 'boolean') return forwarded.autoApprove;
  const policy = forwarded.toolPolicy;
  if (policy && typeof policy === 'object' && 'autoApprove' in policy) {
    return Boolean((policy as { autoApprove?: unknown }).autoApprove);
  }
  return false;
}

export function pickAgUiModel(body: AgUiRunRequest): string | undefined {
  if (typeof body.model === 'string') return body.model;
  const model = body.forwardedProps?.model;
  return typeof model === 'string' ? model : undefined;
}

export function lastToolMessage(messages: AgUiMessage[]): AgUiMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'tool') return messages[i];
  }
  return undefined;
}

export function hasAgUiResumeIntent(body: AgUiRunRequest): boolean {
  if (body.resume && body.resume.length > 0) return true;
  if (lastToolMessage(body.messages)) return true;
  return false;
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export interface AgUiResumeTarget {
  key: string;
  value: unknown;
}

export interface AgUiResumeSnapshot {
  runId: string;
  status: string;
  approvals: Array<{ id: string; toolCallId: string; status: string }>;
  questions: Array<{ id: string; answer?: string }>;
  hasWaiter: (key: string) => boolean;
}

export function resolveAgUiResumes(
  body: AgUiRunRequest,
  snap: AgUiResumeSnapshot,
): AgUiResumeTarget[] {
  const ops: AgUiResumeTarget[] = [];
  for (const item of body.resume ?? []) {
    const mapped = mapResumeItem(item, snap);
    if (mapped) ops.push(mapped);
  }
  if (ops.length === 0) {
    const tool = lastToolMessage(body.messages);
    if (tool) {
      const mapped = mapToolResume(tool, snap);
      if (mapped) ops.push(mapped);
    }
  }
  if (ops.length === 0 && snap.status === 'awaiting_user') {
    const text = extractAgUiUserText(body.messages);
    const pending = snap.questions.find((q) => !q.answer);
    if (text && pending) {
      ops.push({ key: waitKeys.question(pending.id), value: text });
    }
  }
  return ops;
}

function mapResumeItem(item: AgUiResume, snap: AgUiResumeSnapshot): AgUiResumeTarget | undefined {
  const cancelled = item.status === 'cancelled';
  if (item.interruptId === waitKeys.planConfirmation || item.interruptId === 'plan_confirmation') {
    if (cancelled) return { key: waitKeys.planConfirmation, value: { action: 'cancel' } };
    const parsed = PlanConfirmationSchema.safeParse(item.payload ?? { action: 'confirm' });
    return {
      key: waitKeys.planConfirmation,
      value: parsed.success ? parsed.data : { action: 'confirm' },
    };
  }

  const approval = snap.approvals.find(
    (a) => a.id === item.interruptId || a.toolCallId === item.interruptId,
  );
  if (approval || snap.hasWaiter(waitKeys.approval(item.interruptId))) {
    const id = approval?.id ?? item.interruptId;
    if (cancelled) return { key: waitKeys.approval(id), value: { approved: false } };
    const parsed = ApprovalResponseSchema.safeParse(item.payload ?? { approved: true });
    return { key: waitKeys.approval(id), value: parsed.success ? parsed.data : { approved: true } };
  }

  const question = snap.questions.find((q) => q.id === item.interruptId);
  if (question || snap.hasWaiter(waitKeys.question(item.interruptId))) {
    const id = question?.id ?? item.interruptId;
    if (cancelled) return { key: waitKeys.question(id), value: 'cancelled' };
    const payload = item.payload;
    const answer =
      typeof payload === 'string'
        ? payload
        : payload && typeof payload === 'object' && 'answer' in payload
          ? String((payload as { answer: unknown }).answer ?? '')
          : '';
    return { key: waitKeys.question(id), value: answer };
  }

  return undefined;
}

function mapToolResume(
  message: AgUiMessage,
  snap: AgUiResumeSnapshot,
): AgUiResumeTarget | undefined {
  const id = message.toolCallId;
  if (!id) return undefined;
  const payload = parseJson(message.content);
  if (id === waitKeys.planConfirmation || id === 'plan_confirmation') {
    const parsed = PlanConfirmationSchema.safeParse(payload ?? { action: 'confirm' });
    return {
      key: waitKeys.planConfirmation,
      value: parsed.success ? parsed.data : { action: 'confirm' },
    };
  }
  const approval = snap.approvals.find((a) => a.id === id || a.toolCallId === id);
  if (approval) {
    const parsed = ApprovalResponseSchema.safeParse(payload ?? { approved: true });
    return {
      key: waitKeys.approval(approval.id),
      value: parsed.success ? parsed.data : { approved: true },
    };
  }
  const question = snap.questions.find((q) => q.id === id);
  if (question) {
    const answer =
      typeof payload === 'string'
        ? payload
        : payload && typeof payload === 'object' && 'answer' in payload
          ? String((payload as { answer: unknown }).answer ?? '')
          : contentToText(message.content);
    return { key: waitKeys.question(question.id), value: answer };
  }
  return undefined;
}

export function encodeAgUiSse(event: AgUiEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
