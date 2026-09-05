import {
  ApprovalResponseSchema,
  PlanConfirmationSchema,
  QuestionAnswerSchema,
  RUN_ID_HEADER,
  type Run,
  TERMINAL_RUN_STATUSES,
  validateStepGraph,
} from '@loop-agent/shared';
import { createUIMessageStreamResponse } from 'ai';
import { type Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../app.js';
import { waitKeys } from '../runtime/engine/hitl.js';
import { createRunUIStream } from '../runtime/ui-stream.js';

export function runRoutes(ctx: AppContext) {
  const router = new Hono();
  const { stores, runManager, bus } = ctx;

  const loadRun = async (runId: string): Promise<Run> => {
    const run = runManager.get(runId)?.run ?? (await stores.runs.get(runId));
    if (!run) throw new HTTPException(404, { message: 'Run not found' });
    return run;
  };

  router.get('/:id', async (c) => {
    const runId = c.req.param('id');
    const snapshot = runManager.get(runId) ?? (await stores.runs.getSnapshot(runId));
    if (!snapshot) {
      const run = await stores.runs.get(runId);
      if (!run) throw new HTTPException(404, { message: 'Run not found' });
      return c.json({ run, plan: null, approvals: [], questions: [], toolCalls: [], lastSeq: 0 });
    }
    return c.json(snapshot);
  });

  router.get('/:id/events', async (c) => {
    const runId = c.req.param('id');
    await loadRun(runId);
    const fromSeq = Number(c.req.query('fromSeq') ?? 0) || 0;
    const limit = Math.min(Number(c.req.query('limit') ?? 500) || 500, 2000);
    const buffered = bus.has(runId) ? bus.buffered(runId, fromSeq) : null;
    const events = buffered ?? (await stores.runs.events(runId, fromSeq, limit));
    return c.json({ events: events.slice(0, limit), active: runManager.isActive(runId) });
  });

  router.get('/:id/stream', async (c) => {
    const runId = c.req.param('id');
    const run = await loadRun(runId);
    const fromSeq = Number(c.req.query('fromSeq') ?? 0) || 0;
    // Finished and no longer buffered: the client already has the persisted
    // message, so there is nothing to resume (AI SDK treats 204 as "no stream").
    if (TERMINAL_RUN_STATUSES.has(run.status) && !bus.has(runId) && fromSeq === 0) {
      return c.body(null, 204);
    }
    const initial: Run = { ...run, status: 'queued' };
    return createUIMessageStreamResponse({
      stream: createRunUIStream({ bus, run: initial, fromSeq, signal: c.req.raw.signal }),
      headers: { [RUN_ID_HEADER]: runId },
    });
  });

  /** Shared guard for HITL endpoints: the run must be active and waiting on `key`. */
  const deliver = async (c: Context, key: string, value: unknown) => {
    const runId = c.req.param('id') ?? '';
    await loadRun(runId);
    if (!runManager.isActive(runId)) throw new HTTPException(409, { message: 'Run is not active' });
    if (!runManager.hasWaiter(runId, key)) {
      throw new HTTPException(409, { message: 'Run is not waiting for this decision' });
    }
    runManager.resolve(runId, key, value);
    return c.json({ ok: true });
  };

  router.post('/:id/approvals/:approvalId', async (c) => {
    const parsed = ApprovalResponseSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(400, { message: 'Invalid approval response' });
    return deliver(c, waitKeys.approval(c.req.param('approvalId') ?? ''), parsed.data);
  });

  router.post('/:id/questions/:questionId', async (c) => {
    const parsed = QuestionAnswerSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(400, { message: 'Answer is required' });
    return deliver(c, waitKeys.question(c.req.param('questionId') ?? ''), parsed.data.answer);
  });

  router.post('/:id/plan/confirm', async (c) => {
    const parsed = PlanConfirmationSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new HTTPException(400, {
        message: `Invalid plan confirmation: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      });
    }
    if (parsed.data.action === 'edit') {
      const validation = validateStepGraph(parsed.data.steps, {
        availableTools: ctx.tools.plannableNames(),
        maxSteps: ctx.config.BUDGET_MAX_STEPS,
      });
      if (!validation.ok) {
        throw new HTTPException(400, { message: `计划无效：${validation.errors.join('；')}` });
      }
    }
    return deliver(c, waitKeys.planConfirmation, parsed.data);
  });

  router.post('/:id/cancel', async (c) => {
    const runId = c.req.param('id');
    await loadRun(runId);
    const ok = runManager.cancel(runId);
    if (!ok) throw new HTTPException(409, { message: 'Run is not active' });
    return c.json({ ok: true });
  });

  return router;
}
