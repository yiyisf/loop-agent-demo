import {
  dataPartIds,
  emptyUsage,
  type LoopAgentDataParts,
  type LoopAgentMessageMetadata,
  type Run,
  type RunEvent,
  TERMINAL_RUN_STATUSES,
} from '@loop-agent/shared';
import type { UIMessage, UIMessageChunk } from 'ai';
import type { EventBus } from './event-bus.js';
import { type RunSnapshot, RunState } from './projections.js';

export type LoopAgentUIMessage = UIMessage<LoopAgentMessageMetadata, LoopAgentDataParts>;
export type LoopAgentUIChunk = UIMessageChunk<LoopAgentMessageMetadata, LoopAgentDataParts>;

const FINAL_TEXT_ID = 'final';

interface MapperState {
  finalTextStarted: boolean;
  finalTextEnded: boolean;
}

/**
 * Maps one run event to UI message chunks. `state` must already have the
 * event applied so that derived parts (plan/step snapshots) are current.
 */
export function eventToChunks(
  event: RunEvent,
  state: RunState,
  m: MapperState,
): LoopAgentUIChunk[] {
  const chunks: LoopAgentUIChunk[] = [];
  const run = state.run;

  switch (event.type) {
    case 'run.status': {
      chunks.push({
        type: 'data-run',
        id: dataPartIds.run,
        data: {
          runId: run.id,
          threadId: run.threadId,
          status: event.status,
          reason: event.reason,
          seq: event.seq,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          error: run.error,
          model: run.model,
        },
      });
      break;
    }
    case 'plan.created':
      chunks.push({ type: 'data-plan', id: dataPartIds.plan, data: { plan: event.plan } });
      for (const s of event.plan.steps)
        chunks.push({ type: 'data-step', id: dataPartIds.step(s.id), data: s });
      break;
    case 'plan.revised':
      chunks.push({
        type: 'data-plan',
        id: dataPartIds.plan,
        data: { plan: event.plan, diff: event.diff, reason: event.reason },
      });
      for (const s of event.plan.steps)
        chunks.push({ type: 'data-step', id: dataPartIds.step(s.id), data: s });
      break;
    case 'step.status':
    case 'step.result': {
      const step = state.step(event.stepId);
      if (step) chunks.push({ type: 'data-step', id: dataPartIds.step(step.id), data: step });
      break;
    }
    case 'step.text_delta':
      chunks.push({
        type: 'data-step-log',
        data: { stepId: event.stepId, kind: 'text', delta: event.delta },
        transient: true,
      });
      break;
    case 'step.reasoning_delta':
      chunks.push({
        type: 'data-step-log',
        data: { stepId: event.stepId, kind: 'reasoning', delta: event.delta },
        transient: true,
      });
      break;
    case 'tool.call':
    case 'tool.result': {
      const rec = state.toolCalls.get(event.toolCallId);
      if (rec)
        chunks.push({ type: 'data-tool', id: dataPartIds.tool(rec.toolCallId), data: { ...rec } });
      break;
    }
    case 'approval.requested':
    case 'approval.resolved': {
      const a = state.approvals.get(event.approvalId);
      if (a) chunks.push({ type: 'data-approval', id: dataPartIds.approval(a.id), data: { ...a } });
      break;
    }
    case 'user_question.asked':
    case 'user_question.answered': {
      const q = state.questions.get(event.questionId);
      if (q) chunks.push({ type: 'data-question', id: dataPartIds.question(q.id), data: { ...q } });
      break;
    }
    case 'final.text_delta':
      if (!m.finalTextStarted) {
        chunks.push({ type: 'text-start', id: FINAL_TEXT_ID });
        m.finalTextStarted = true;
        // When resuming mid-answer, catch up with everything accumulated so far.
        chunks.push({ type: 'text-delta', id: FINAL_TEXT_ID, delta: state.finalText });
        break;
      }
      chunks.push({ type: 'text-delta', id: FINAL_TEXT_ID, delta: event.delta });
      break;
    case 'final.done':
      if (!m.finalTextStarted) {
        chunks.push({ type: 'text-start', id: FINAL_TEXT_ID });
        chunks.push({ type: 'text-delta', id: FINAL_TEXT_ID, delta: event.answer });
        m.finalTextStarted = true;
      }
      if (!m.finalTextEnded) {
        chunks.push({ type: 'text-end', id: FINAL_TEXT_ID });
        m.finalTextEnded = true;
      }
      break;
    case 'usage':
      chunks.push({ type: 'data-usage', id: dataPartIds.usage, data: run.usage });
      break;
    case 'log':
      if (event.level === 'warn' || event.level === 'error') {
        chunks.push({
          type: 'data-notice',
          data: { level: event.level === 'error' ? 'error' : 'warn', message: event.message },
          transient: true,
        });
      }
      break;
    case 'error':
      // Fatal errors are followed by a terminal `run.status`, which carries the
      // reason; an `error` chunk would abort client-side processing before it.
      chunks.push({
        type: 'data-notice',
        data: { level: 'error', message: event.message },
        transient: true,
      });
      break;
    case 'reflection':
      break;
    default:
      break;
  }
  return chunks;
}

export interface RunUIStreamOptions {
  bus: EventBus;
  /** The run as it was created (status queued); events rebuild everything else. */
  run: Run;
  /** Only events with seq > fromSeq are emitted; earlier ones are replayed silently. */
  fromSeq?: number;
  signal?: AbortSignal;
  /** Whether to emit the `start` chunk (false when resuming into an existing message). */
  withStart?: boolean;
  messageId?: string;
}

/**
 * Produces a UI message stream for a run: replays events after `fromSeq`, then
 * streams live ones until the run reaches a terminal status. The stream keeps
 * its own projection so it never depends on the engine's in-flight state.
 */
export function createRunUIStream(options: RunUIStreamOptions): ReadableStream<LoopAgentUIChunk> {
  const { bus, run, fromSeq = 0, signal, withStart = true } = options;
  const runId = run.id;
  const mapper: MapperState = { finalTextStarted: false, finalTextEnded: false };
  const messageId = options.messageId ?? `msg_${runId}`;
  const state = new RunState({ ...run, status: 'queued', usage: emptyUsage() });

  return new ReadableStream<LoopAgentUIChunk>({
    async start(controller) {
      const write = (c: LoopAgentUIChunk) => controller.enqueue(c);
      try {
        if (withStart) {
          write({
            type: 'start',
            messageId,
            messageMetadata: { runId, threadId: run.threadId, createdAt: run.createdAt },
          });
          write({ type: 'start-step' });
        }

        for await (const event of bus.subscribe(runId, 0, signal)) {
          state.apply(event);
          if (event.seq <= fromSeq) continue;
          for (const chunk of eventToChunks(event, state, mapper)) write(chunk);
          if (event.type === 'run.status' && TERMINAL_RUN_STATUSES.has(event.status)) break;
        }

        if (mapper.finalTextStarted && !mapper.finalTextEnded)
          write({ type: 'text-end', id: FINAL_TEXT_ID });
        write({ type: 'finish-step' });
        write({ type: 'finish', messageMetadata: { runId } });
      } catch (err) {
        write({ type: 'error', errorText: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
}

/** Builds the persisted assistant message for a finished run. */
export function buildAssistantMessage(snapshot: RunSnapshot): LoopAgentUIMessage {
  const { run, plan, toolCalls, approvals, questions } = snapshot;
  const parts: LoopAgentUIMessage['parts'] = [];
  parts.push({
    type: 'data-run',
    id: dataPartIds.run,
    data: {
      runId: run.id,
      threadId: run.threadId,
      status: run.status,
      reason: run.error,
      seq: snapshot.lastSeq,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      error: run.error,
      model: run.model,
    },
  });
  if (plan) {
    parts.push({ type: 'data-plan', id: dataPartIds.plan, data: { plan } });
    for (const s of plan.steps)
      parts.push({ type: 'data-step', id: dataPartIds.step(s.id), data: s });
  }
  for (const t of toolCalls)
    parts.push({ type: 'data-tool', id: dataPartIds.tool(t.toolCallId), data: t });
  for (const a of approvals)
    parts.push({ type: 'data-approval', id: dataPartIds.approval(a.id), data: a });
  for (const q of questions)
    parts.push({ type: 'data-question', id: dataPartIds.question(q.id), data: q });
  if (run.finalAnswer) parts.push({ type: 'text', text: run.finalAnswer, state: 'done' });
  parts.push({ type: 'data-usage', id: dataPartIds.usage, data: run.usage });

  return {
    id: `msg_${run.id}`,
    role: 'assistant',
    metadata: { runId: run.id, threadId: run.threadId, model: run.model, createdAt: run.createdAt },
    parts,
  };
}
