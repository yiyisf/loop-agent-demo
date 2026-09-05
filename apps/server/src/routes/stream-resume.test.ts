import { afterEach, describe, expect, it } from 'vitest';
import { defaultMockScript, type MockScript } from '../providers/mock-model.js';
import { createTestHarness } from '../test/harness.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const slowScript: MockScript = async (ctx) => {
  if (ctx.role === 'executor') await new Promise((r) => setTimeout(r, 120));
  return defaultMockScript(ctx);
};

describe('stream reconnection', () => {
  it('resumes a live run from scratch into the same assistant message after the client drops', async () => {
    const h = await createTestHarness({ script: slowScript });
    cleanup = h.cleanup;

    const controller = new AbortController();
    const thread = await h.ctx.stores.threads.create();
    const first = await h.app.request(`/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'reconnect me' }),
      signal: controller.signal,
    });
    const runId = first.headers.get('x-run-id')!;

    // Read only the first few chunks, then simulate a dropped connection.
    const reader = first.body!.getReader();
    await reader.read();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => undefined);

    expect(h.ctx.runManager.isActive(runId)).toBe(true);

    const resumed = await h.app.request(`/api/runs/${runId}/stream`);
    expect(resumed.status).toBe(200);
    expect(resumed.headers.get('x-run-id')).toBe(runId);
    const chunks = await h.readSse(resumed);

    expect(chunks[0]).toMatchObject({ type: 'start', messageId: `msg_${runId}` });
    const planChunks = chunks.filter((c) => c.type === 'data-plan');
    expect(planChunks.length).toBeGreaterThan(0);
    const stepIds = new Set(chunks.filter((c) => c.type === 'data-step').map((c) => c.id));
    expect([...stepIds].sort()).toEqual(['step:understand', 'step:verify', 'step:work']);
    expect(chunks.filter((c) => c.type === 'text-start')).toHaveLength(1);
    expect(chunks.filter((c) => c.type === 'text-end')).toHaveLength(1);
    const runStatuses = chunks
      .filter((c) => c.type === 'data-run')
      .map((c) => (c.data as { status: string }).status);
    expect(runStatuses[0]).toBe('planning');
    expect(runStatuses.at(-1)).toBe('succeeded');
    expect(chunks.at(-1)?.type).toBe('finish');

    await h.collectEvents(runId);
    const messages = await h.ctx.stores.threads.messages(thread.id);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1]!.id).toBe(`msg_${runId}`);
  });

  it('replays only events after fromSeq but still sends the full final answer', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;
    const { runId, res } = await h.startRun('partial replay');
    await res.text();
    const events = await h.collectEvents(runId);
    const finalDone = events.find((e) => e.type === 'final.done')!;

    const resumed = await h.app.request(`/api/runs/${runId}/stream?fromSeq=${finalDone.seq - 1}`);
    const chunks = await h.readSse(resumed);
    const text = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => c.delta as string)
      .join('');
    expect(text).toContain('mock 模型');
    expect(chunks.some((c) => c.type === 'data-plan')).toBe(false);
    expect(chunks.at(-1)?.type).toBe('finish');
  });
});
