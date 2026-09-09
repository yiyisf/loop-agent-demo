import {
  PlanConfirmationSchema,
  RUN_ID_HEADER,
  type Run,
  THREAD_ID_HEADER,
  validateStepGraph,
} from '@loop-agent/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../app.js';
import { newId, nowIso } from '../lib/ids.js';
import {
  type AgUiEvent,
  type AgUiRunRequest,
  AgUiRunRequestSchema,
  closeAgUiText,
  createAgUiTranslateState,
  encodeAgUiSse,
  extractAgUiUserText,
  hasAgUiResumeIntent,
  isAgUiHitlPause,
  isAgUiTerminal,
  pickAgUiAutoApprove,
  pickAgUiMode,
  pickAgUiModel,
  resolveAgUiResumes,
  runEventToAgUi,
} from '../runtime/ag-ui.js';
import { waitKeys } from '../runtime/engine/hitl.js';
import { fallbackTitle } from '../runtime/title.js';
import type { LoopAgentUIMessage } from '../runtime/ui-stream.js';
import { buildHistory } from './threads.js';

export function agUiRoutes(ctx: AppContext) {
  const router = new Hono();
  const { stores, runManager, bus } = ctx;

  router.post('/', async (c) => {
    const parsed = AgUiRunRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(400, { message: 'Invalid AG-UI request' });
    const body = parsed.data;

    const threadId = body.threadId?.trim() || newId('thr');
    const thread = await stores.threads.ensure(threadId);
    const active = runManager.activeRunForThread(thread.id);

    if (active) {
      const userText = extractAgUiUserText(body.messages);
      const resumeIntent =
        hasAgUiResumeIntent(body) || (active.status === 'awaiting_user' && Boolean(userText));
      if (!resumeIntent) {
        throw new HTTPException(409, { message: 'A run is already active in this thread' });
      }
      const fromSeq = bus.currentSeq(active.id);
      if (!applyResume(ctx, active, body)) {
        throw new HTTPException(409, { message: 'Run is not waiting for this decision' });
      }
      return sseResponse({
        bus,
        run: active,
        threadId: thread.id,
        fromSeq,
        signal: c.req.raw.signal,
        cancelOnAbort: (runId) => runManager.cancel(runId),
      });
    }

    const text = extractAgUiUserText(body.messages);
    if (!text) throw new HTTPException(400, { message: 'Message text is required' });

    const previous = await stores.threads.messages(thread.id);
    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
    const userMessage: LoopAgentUIMessage = {
      id: lastUser?.id || newId('msg'),
      role: 'user',
      metadata: { threadId: thread.id, createdAt: nowIso() },
      parts: [{ type: 'text', text }],
    };
    await stores.threads.appendMessage(thread.id, userMessage);
    if (previous.length === 0) {
      await stores.threads.updateTitle(thread.id, fallbackTitle(text));
    }

    const run = await runManager.start({
      threadId: thread.id,
      input: text,
      mode: pickAgUiMode(body),
      model: pickAgUiModel(body),
      autoApprove: pickAgUiAutoApprove(body),
      history: buildHistory(previous),
    });

    return sseResponse({
      bus,
      run,
      threadId: thread.id,
      fromSeq: 0,
      signal: c.req.raw.signal,
      cancelOnAbort: (runId) => runManager.cancel(runId),
    });
  });

  return router;
}

function applyResume(ctx: AppContext, run: Run, body: AgUiRunRequest): boolean {
  const snap = ctx.runManager.get(run.id);
  if (!snap) return false;
  const ops = resolveAgUiResumes(body, {
    runId: run.id,
    status: snap.run.status,
    approvals: snap.approvals,
    questions: snap.questions,
    hasWaiter: (key) => ctx.runManager.hasWaiter(run.id, key),
  });
  if (ops.length === 0) return false;

  for (const op of ops) {
    if (op.key === waitKeys.planConfirmation) {
      const parsed = PlanConfirmationSchema.safeParse(op.value);
      if (!parsed.success) return false;
      if (parsed.data.action === 'edit') {
        const validation = validateStepGraph(parsed.data.steps, {
          availableTools: ctx.tools.plannableNames(),
          maxSteps: ctx.config.BUDGET_MAX_STEPS,
        });
        if (!validation.ok) return false;
      }
      op.value = parsed.data;
    }
    if (!ctx.runManager.hasWaiter(run.id, op.key)) return false;
  }

  let delivered = false;
  for (const op of ops) {
    if (ctx.runManager.resolve(run.id, op.key, op.value)) delivered = true;
  }
  return delivered;
}

function sseResponse(opts: {
  bus: AppContext['bus'];
  run: Run;
  threadId: string;
  fromSeq: number;
  signal: AbortSignal;
  cancelOnAbort: (runId: string) => void;
}): Response {
  const { bus, run, threadId, fromSeq, signal, cancelOnAbort } = opts;
  const encoder = new TextEncoder();
  let closedDueToInterrupt = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: AgUiEvent) => {
        controller.enqueue(encoder.encode(encodeAgUiSse(event)));
      };
      const onAbort = () => {
        if (!closedDueToInterrupt) cancelOnAbort(run.id);
      };
      signal.addEventListener('abort', onAbort, { once: true });

      try {
        write({ type: 'RUN_STARTED', threadId, runId: run.id });
        const state = createAgUiTranslateState(run.id);
        for await (const event of bus.subscribe(run.id, fromSeq, signal)) {
          for (const mapped of runEventToAgUi(event, state)) write(mapped);

          if (isAgUiHitlPause(event, state)) {
            for (const mapped of closeAgUiText(state)) write(mapped);
            write({
              type: 'RUN_FINISHED',
              threadId,
              runId: run.id,
              outcome: { type: 'interrupt', interrupts: state.pendingInterrupts },
            });
            closedDueToInterrupt = true;
            break;
          }

          if (isAgUiTerminal(event)) {
            for (const mapped of closeAgUiText(state)) write(mapped);
            if (event.status === 'failed') {
              write({
                type: 'RUN_ERROR',
                message: event.reason ?? 'Run failed',
                code: 'run_failed',
              });
            }
            write({
              type: 'RUN_FINISHED',
              threadId,
              runId: run.id,
              result: { status: event.status },
              outcome: {
                type:
                  event.status === 'succeeded'
                    ? 'success'
                    : event.status === 'cancelled'
                      ? 'cancel'
                      : 'error',
              },
            });
            break;
          }
        }
      } catch (err) {
        write({
          type: 'RUN_ERROR',
          message: err instanceof Error ? err.message : 'stream error',
        });
      } finally {
        signal.removeEventListener('abort', onAbort);
        controller.close();
      }
    },
    cancel() {
      if (!closedDueToInterrupt) cancelOnAbort(run.id);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      [RUN_ID_HEADER]: run.id,
      [THREAD_ID_HEADER]: threadId,
    },
  });
}
