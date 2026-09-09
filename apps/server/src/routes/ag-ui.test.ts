import { afterEach, describe, expect, it } from 'vitest';
import { createTestHarness } from '../test/harness.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const postAgUi = (h: Awaited<ReturnType<typeof createTestHarness>>, body: unknown) =>
  h.app.request('/api/ag-ui', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

function typesOf(events: Array<Record<string, unknown>>): string[] {
  return events.map((e) => String(e.type));
}

describe('POST /api/ag-ui', () => {
  it('streams a conversation turn as AG-UI events', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;

    const res = await postAgUi(h, {
      threadId: 'thr_agui_hello',
      messages: [{ id: 'm1', role: 'user', content: '你好' }],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-thread-id')).toBe('thr_agui_hello');
    const runId = res.headers.get('x-run-id');
    expect(runId).toBeTruthy();

    const events = await h.readSse(res);
    const types = typesOf(events);
    expect(types[0]).toBe('RUN_STARTED');
    expect(events[0]).toMatchObject({ threadId: 'thr_agui_hello', runId });
    expect(types).toContain('TEXT_MESSAGE_START');
    expect(types).toContain('TEXT_MESSAGE_CONTENT');
    expect(types).toContain('TEXT_MESSAGE_END');
    expect(types.at(-1)).toBe('RUN_FINISHED');
    expect(events.at(-1)).toMatchObject({ outcome: { type: 'success' } });
    expect(events.some((e) => e.type === 'STATE_SNAPSHOT')).toBe(false);
    expect(events.some((e) => e.type === 'CUSTOM' && e.name === 'plan')).toBe(false);

    await h.ctx.runManager.wait(runId!);
    expect(h.ctx.runManager.get(runId!)?.run.status).toBe('succeeded');
    expect(h.ctx.runManager.get(runId!)?.plan).toBeNull();
  });

  it('accepts input-content parts and starts a workflow with a plan snapshot', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;

    const res = await postAgUi(h, {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: '对比 Zustand、Jotai 与 Redux Toolkit' }],
        },
      ],
    });
    expect(res.status).toBe(200);
    const events = await h.readSse(res);
    expect(typesOf(events)[0]).toBe('RUN_STARTED');
    expect(
      events.some((e) => e.type === 'STATE_SNAPSHOT' || (e.type === 'CUSTOM' && e.name === 'plan')),
    ).toBe(true);
    expect(events.some((e) => e.type === 'STEP_STARTED')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'RUN_FINISHED', outcome: { type: 'success' } });
  });

  it('rejects an empty body', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;
    const res = await postAgUi(h, { messages: [] });
    expect(res.status).toBe(400);
  });

  it('pauses on tool approval and resumes through resume[]', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;

    const first = await postAgUi(h, {
      threadId: 'thr_agui_fetch',
      messages: [{ role: 'user', content: '抓取 https://example.com/ 并总结' }],
    });
    expect(first.status).toBe(200);
    const paused = await h.readSse(first);
    const finished = paused.find((e) => e.type === 'RUN_FINISHED') as {
      outcome?: { type?: string; interrupts?: Array<{ id: string; reason: string }> };
    };
    expect(finished?.outcome?.type).toBe('interrupt');
    expect(paused.some((e) => e.type === 'CUSTOM' && e.name === 'approval')).toBe(true);
    const interrupt = finished.outcome?.interrupts?.[0];
    expect(interrupt?.reason).toBe('approval');
    expect(interrupt?.id).toBeTruthy();

    const runId = first.headers.get('x-run-id')!;
    expect(h.ctx.runManager.isActive(runId)).toBe(true);
    expect(h.ctx.runManager.get(runId)?.run.status).toBe('awaiting_approval');

    const conflict = await postAgUi(h, {
      threadId: 'thr_agui_fetch',
      messages: [{ role: 'user', content: '再问一句' }],
    });
    expect(conflict.status).toBe(409);

    const second = await postAgUi(h, {
      threadId: 'thr_agui_fetch',
      resume: [{ interruptId: interrupt!.id, status: 'resolved', payload: { approved: true } }],
    });
    expect(second.status).toBe(200);
    const continued = await h.readSse(second);
    expect(typesOf(continued)[0]).toBe('RUN_STARTED');
    expect(continued.at(-1)).toMatchObject({
      type: 'RUN_FINISHED',
      outcome: { type: 'success' },
    });
    await h.ctx.runManager.wait(runId);
    expect(h.ctx.runManager.get(runId)?.run.status).toBe('succeeded');
  }, 15_000);

  it('reuses an existing client threadId', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;

    const first = await postAgUi(h, {
      threadId: 'thr_reuse',
      messages: [{ role: 'user', content: '你好' }],
    });
    await first.text();

    const second = await postAgUi(h, {
      threadId: 'thr_reuse',
      messages: [{ role: 'user', content: '再解释一下' }],
    });
    expect(second.headers.get('x-thread-id')).toBe('thr_reuse');
    const events = await h.readSse(second);
    expect(events.at(-1)).toMatchObject({ type: 'RUN_FINISHED' });

    const listed = await h.ctx.stores.threads.list();
    expect(listed.filter((t) => t.id === 'thr_reuse')).toHaveLength(1);
    const messages = await h.ctx.stores.threads.messages('thr_reuse');
    expect(messages.filter((m) => m.role === 'user')).toHaveLength(2);
  });

  it('pauses for plan confirmation and resumes with resume[]', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;

    const first = await postAgUi(h, {
      threadId: 'thr_agui_plan',
      messages: [{ role: 'user', content: '调研 TypeScript 学习路线' }],
      mode: 'plan_first',
    });
    expect(first.status).toBe(200);
    const paused = await h.readSse(first);
    const finished = paused.find((e) => e.type === 'RUN_FINISHED') as {
      outcome?: { type?: string; interrupts?: Array<{ id: string; reason: string }> };
    };
    expect(finished?.outcome?.type).toBe('interrupt');
    expect(finished.outcome?.interrupts?.[0]?.reason).toBe('plan_confirmation');
    expect(paused.some((e) => e.type === 'STATE_SNAPSHOT' || e.name === 'plan')).toBe(true);

    const runId = first.headers.get('x-run-id')!;
    expect(h.ctx.runManager.get(runId)?.run.status).toBe('awaiting_plan_confirmation');

    const second = await postAgUi(h, {
      threadId: 'thr_agui_plan',
      resume: [
        { interruptId: 'plan_confirmation', status: 'resolved', payload: { action: 'confirm' } },
      ],
    });
    expect(second.status).toBe(200);
    const continued = await h.readSse(second);
    expect(continued.at(-1)).toMatchObject({ type: 'RUN_FINISHED', outcome: { type: 'success' } });
    await h.ctx.runManager.wait(runId);
    expect(h.ctx.runManager.get(runId)?.run.status).toBe('succeeded');
  });
});
