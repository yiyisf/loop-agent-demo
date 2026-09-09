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

    const { runId, res } = await h.startRun('你好');
    await res.text();
    await h.collectEvents(runId);

    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.run.status).toBe('succeeded');
    expect(snapshot.plan).toBeNull();
    expect(snapshot.run.finalAnswer).toMatch(/对话模式/);
  });

  it('answers from an attached markdown file', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;

    const { runId, res, thread } = await h.startRun('总结这份文件的要点', {
      attachments: [
        {
          name: 'notes.md',
          mime: 'text/markdown',
          text: '# 季度目标\n提高续费率到 40%。\n下一阶段做客户回访。',
        },
      ],
    });
    await res.text();
    await h.collectEvents(runId);

    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.run.status).toBe('succeeded');
    expect(snapshot.plan).toBeNull();
    expect(snapshot.run.finalAnswer).toMatch(/续费率|季度目标/);
    expect(snapshot.run.finalAnswer).toMatch(/notes\.md/);

    const messages = await h.ctx.stores.threads.messages(thread.id);
    const user = messages.find((m) => m.role === 'user');
    expect(user?.parts.some((p) => p.type === 'data-attachment')).toBe(true);
  });
});

