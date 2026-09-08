import { afterEach, describe, expect, it } from 'vitest';
import { createTestHarness } from '../../test/harness.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe('chat turn', () => {
  it('answers without creating a plan', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;

    const { runId, res } = await h.startRun('你好', { mode: 'chat' });
    await res.text();
    await h.collectEvents(runId);

    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.run.status).toBe('succeeded');
    expect(snapshot.plan).toBeNull();
    expect(snapshot.run.finalAnswer).toMatch(/对话模式/);
  });
});
