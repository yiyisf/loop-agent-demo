import { afterEach, describe, expect, it } from 'vitest';
import type { MockScript } from '../../providers/mock-model.js';
import { defaultMockScript } from '../../providers/mock-model.js';
import { createTestHarness } from '../../test/harness.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe('LoopEngine (serial)', () => {
  it('plans, executes each step with tools and finalizes', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;

    const { runId, res, thread } = await h.startRun('计算 (12+30)*2 并说明');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const chunks = await h.readSse(res);
    const types = chunks.map((c) => c.type);
    expect(types[0]).toBe('start');
    expect(types).toContain('data-plan');
    expect(types).toContain('data-step');
    expect(types).toContain('data-tool');
    expect(types).toContain('text-delta');
    expect(types.at(-1)).toBe('finish');

    const events = await h.collectEvents(runId);
    const statuses = events.filter((e) => e.type === 'run.status').map((e) => e.status);
    expect(statuses).toEqual(['planning', 'executing', 'finalizing', 'succeeded']);

    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.run.status).toBe('succeeded');
    expect(snapshot.plan?.steps.map((s) => s.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(snapshot.toolCalls).toHaveLength(1);
    expect(snapshot.toolCalls[0]?.toolName).toBe('calculator');
    expect(snapshot.toolCalls[0]?.output).toMatchObject({ result: '84' });
    expect(snapshot.run.finalAnswer).toContain('结论');
    expect(snapshot.run.usage.llmCalls).toBeGreaterThan(3);

    const messages = await h.ctx.stores.threads.messages(thread.id);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    const assistant = messages[1]!;
    expect(assistant.parts.some((p) => p.type === 'data-plan')).toBe(true);
    expect(assistant.parts.some((p) => p.type === 'text')).toBe(true);
  });

  it('retries a failing step and marks downstream steps blocked', async () => {
    let workAttempts = 0;
    const script: MockScript = (ctx) => {
      if (ctx.role === 'executor' && ctx.systemText.includes('- id: work')) {
        workAttempts += 1;
        return {
          toolCalls: [
            {
              toolName: 'finish_step',
              input: { status: 'failed', summary: 'could not do it', artifacts: [] },
            },
          ],
        };
      }
      return defaultMockScript(ctx);
    };
    const h = await createTestHarness({ script });
    cleanup = h.cleanup;

    const { runId, res } = await h.startRun('任务');
    await res.text();
    await h.collectEvents(runId);

    const snapshot = h.ctx.runManager.get(runId)!;
    expect(workAttempts).toBe(2);
    expect(snapshot.plan?.steps.map((s) => s.status)).toEqual(['succeeded', 'failed', 'blocked']);
    expect(snapshot.run.status).toBe('failed');
    expect(snapshot.run.error).toMatch(/did not complete/);
    // The finalizer still produced an answer summarising partial progress.
    expect(snapshot.run.finalAnswer).toBeTruthy();
  });

  it('cancels an active run', async () => {
    const script: MockScript = async (ctx) => {
      if (ctx.role === 'executor') await new Promise((r) => setTimeout(r, 300));
      return defaultMockScript(ctx);
    };
    const h = await createTestHarness({ script });
    cleanup = h.cleanup;

    const { runId, res } = await h.startRun('慢任务');
    await new Promise((r) => setTimeout(r, 150));
    const cancel = await h.app.request(`/api/runs/${runId}/cancel`, { method: 'POST' });
    expect(cancel.status).toBe(200);
    await res.text();
    await h.collectEvents(runId);

    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.run.status).toBe('cancelled');
    expect(snapshot.plan?.steps.some((s) => s.status === 'cancelled')).toBe(true);
  });

  it('rejects a second concurrent run in the same thread and serves snapshots', async () => {
    const script: MockScript = async (ctx) => {
      if (ctx.role === 'executor') await new Promise((r) => setTimeout(r, 200));
      return defaultMockScript(ctx);
    };
    const h = await createTestHarness({ script });
    cleanup = h.cleanup;

    const { runId, res, thread } = await h.startRun('a');
    const second = await h.app.request(`/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'b' }),
    });
    expect(second.status).toBe(409);

    const snap = await h.app.request(`/api/runs/${runId}`);
    expect(snap.status).toBe(200);
    expect(((await snap.json()) as { run: { id: string } }).run.id).toBe(runId);

    await res.text();
    await h.collectEvents(runId);

    const resumed = await h.app.request(`/api/runs/${runId}/stream?fromSeq=5`);
    const chunks = await h.readSse(resumed);
    expect(chunks[0]?.type).toBe('start');
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true);
    expect(chunks.at(-1)?.type).toBe('finish');
  });
});
