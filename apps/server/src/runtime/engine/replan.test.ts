import { afterEach, describe, expect, it } from 'vitest';
import { defaultMockScript, type MockScript } from '../../providers/mock-model.js';
import { createTestHarness } from '../../test/harness.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const finish = (status: 'succeeded' | 'failed', summary: string) => ({
  toolCalls: [{ toolName: 'finish_step', input: { status, summary, artifacts: [] } }],
});

const parallelPlan = (n: number) => ({
  json: {
    objective: 'parallel demo',
    steps: Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`,
      title: `Parallel ${i + 1}`,
      goal: `do ${i + 1}`,
      dependsOn: [],
      tools: [],
      acceptance: 'ok',
    })),
  },
});

describe('LoopEngine reflection & replanning', () => {
  it('replans after a failed step: updates the step and adds a new one, then succeeds', async () => {
    let workRuns = 0;
    const script: MockScript = (ctx) => {
      if (ctx.role === 'executor' && ctx.systemText.includes('- id: work')) {
        workRuns += 1;
        // Fails until the goal has been rewritten by the reflector's patch.
        return ctx.systemText.includes('alternative approach')
          ? finish('succeeded', 'done via alternative')
          : finish('failed', 'primary approach broke');
      }
      if (ctx.role === 'reflector') {
        if (ctx.lastUserText.includes('status failed')) {
          return {
            json: {
              action: 'replan',
              reason: 'primary approach failed, switching strategy',
              patch: [
                {
                  op: 'update',
                  stepId: 'work',
                  changes: { goal: 'Use the alternative approach.' },
                },
                {
                  op: 'add',
                  step: {
                    id: 'double-check',
                    title: 'Double check',
                    goal: 'verify alternative',
                    dependsOn: ['work'],
                    tools: [],
                    acceptance: 'ok',
                  },
                },
              ],
            },
          };
        }
        return { json: { action: 'continue' } };
      }
      return defaultMockScript(ctx);
    };
    const h = await createTestHarness({ script, env: { BUDGET_MAX_REPLANS: '2' } });
    cleanup = h.cleanup;

    const { runId, res } = await h.startRun('replan me');
    await res.text();
    const events = await h.collectEvents(runId);

    const revised = events.filter((e) => e.type === 'plan.revised');
    expect(revised).toHaveLength(1);
    const rev = revised[0]!;
    if (rev.type !== 'plan.revised') throw new Error('unreachable');
    expect(rev.plan.revision).toBe(2);
    expect(rev.diff.updated).toContain('work');
    expect(rev.diff.added).toEqual(['double-check']);
    expect(rev.reason).toMatch(/switching strategy/);

    const statuses = events.filter((e) => e.type === 'run.status').map((e) => e.status);
    expect(statuses).toContain('replanning');

    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.run.status).toBe('succeeded');
    expect(snapshot.plan?.steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      'understand:succeeded',
      'work:succeeded',
      'verify:succeeded',
      'double-check:succeeded',
    ]);
    // 2 failed attempts (maxAttemptsPerStep) + 1 successful run after replan
    expect(workRuns).toBe(3);
    expect(events.filter((e) => e.type === 'reflection').length).toBeGreaterThan(0);
  });

  it('fails the run (after a best-effort final answer) when a replan is requested with no budget left', async () => {
    const script: MockScript = (ctx) => {
      if (ctx.role === 'executor' && ctx.systemText.includes('- id: work'))
        return finish('failed', 'nope');
      if (ctx.role === 'reflector') {
        return {
          json: {
            action: 'replan',
            reason: 'try again',
            patch: [{ op: 'update', stepId: 'work', changes: { goal: 'again' } }],
          },
        };
      }
      return defaultMockScript(ctx);
    };
    const h = await createTestHarness({ script, env: { BUDGET_MAX_REPLANS: '0' } });
    cleanup = h.cleanup;

    const { runId, res } = await h.startRun('no replans');
    await res.text();
    const events = await h.collectEvents(runId);
    expect(events.some((e) => e.type === 'plan.revised')).toBe(false);
    expect(events.some((e) => e.type === 'final.done')).toBe(true);
    const skipped = events.filter((e) => e.type === 'step.status' && e.status === 'skipped');
    expect(skipped.length).toBeGreaterThan(0);
    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.run.status).toBe('failed');
    expect(snapshot.run.error).toMatch(/Replan budget exhausted/);
  });

  it('finishes early and skips the remaining steps', async () => {
    const script: MockScript = (ctx) => {
      if (ctx.role === 'planner') return parallelPlan(3);
      if (ctx.role === 'reflector')
        return { json: { action: 'finish_early', reason: 'already enough' } };
      return defaultMockScript(ctx);
    };
    // Successful steps only reach the model reflector when forced on.
    const h = await createTestHarness({
      script,
      env: { BUDGET_MAX_PARALLEL: '1', REFLECT_ON_SUCCESS: 'true' },
    });
    cleanup = h.cleanup;

    const { runId, res } = await h.startRun('finish early');
    await res.text();
    await h.collectEvents(runId);
    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.run.status).toBe('succeeded');
    expect(snapshot.plan?.steps.map((s) => s.status)).toEqual(['succeeded', 'skipped', 'skipped']);
  });

  it('runs independent steps in parallel up to maxParallel', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const script: MockScript = async (ctx) => {
      if (ctx.role === 'planner') return parallelPlan(4);
      if (ctx.role === 'executor') {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 60));
        concurrent -= 1;
        return finish('succeeded', 'ok');
      }
      return defaultMockScript(ctx);
    };
    const h = await createTestHarness({
      script,
      env: { BUDGET_MAX_PARALLEL: '2', REFLECT_ON_SUCCESS: 'false' },
    });
    cleanup = h.cleanup;

    const { runId, res } = await h.startRun('parallel');
    await res.text();
    const events = await h.collectEvents(runId);
    expect(maxConcurrent).toBe(2);
    // Confident successes never reach the model reflector.
    expect(
      events.every(
        (e) =>
          e.type !== 'reflection' ||
          (e.decision.action === 'continue' && e.decision.note?.startsWith('rule:')),
      ),
    ).toBe(true);
    expect(h.ctx.runManager.get(runId)!.run.status).toBe('succeeded');
  });

  it('fails the run when the token budget is exceeded but still writes a final answer', async () => {
    const h = await createTestHarness({ env: { BUDGET_MAX_TOTAL_TOKENS: '700' } });
    cleanup = h.cleanup;
    const { runId, res } = await h.startRun('budget');
    await res.text();
    const events = await h.collectEvents(runId);
    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.run.status).toBe('failed');
    expect(snapshot.run.error).toMatch(/Token budget exceeded/);
    expect(events.some((e) => e.type === 'final.done')).toBe(true);
    expect(snapshot.run.finalAnswer).toBeTruthy();
  });

  it('uses the rule-based reflector for confident successes and the model for failures', async () => {
    const reflectorCalls: string[] = [];
    const script: MockScript = (ctx) => {
      if (ctx.role === 'reflector') reflectorCalls.push(ctx.lastUserText);
      return defaultMockScript(ctx);
    };
    const h = await createTestHarness({ script });
    cleanup = h.cleanup;
    const { runId, res } = await h.startRun('rule reflection');
    await res.text();
    const events = await h.collectEvents(runId);
    const reflections = events.filter((e) => e.type === 'reflection');
    expect(reflections.length).toBeGreaterThan(0);
    expect(reflectorCalls).toHaveLength(0);
    for (const r of reflections) {
      expect(r.decision.action).toBe('continue');
      expect(r.decision.action === 'continue' && r.decision.note).toMatch(/^rule:/);
    }
  });
});
