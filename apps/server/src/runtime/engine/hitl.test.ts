import type { RunEvent } from '@loop-agent/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultMockScript, type MockScript } from '../../providers/mock-model.js';
import { createTestHarness } from '../../test/harness.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls the run's buffered events until one matches. */
async function waitForEvent<T extends RunEvent['type']>(
  h: Awaited<ReturnType<typeof createTestHarness>>,
  runId: string,
  type: T,
  timeoutMs = 5000,
): Promise<Extract<RunEvent, { type: T }>> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const hit = h.ctx.bus.buffered(runId).find((e) => e.type === type);
    if (hit) return hit as Extract<RunEvent, { type: T }>;
    await sleep(15);
  }
  throw new Error(`timed out waiting for ${type}`);
}

const post = (h: Awaited<ReturnType<typeof createTestHarness>>, path: string, body: unknown) =>
  h.app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('HITL: tool approval', () => {
  it('pauses medium-risk tools until approved, then executes them', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;
    const { runId, res } = await h.startRun('抓取 https://example.com/ 并总结');

    const requested = await waitForEvent(h, runId, 'approval.requested');
    expect(requested.toolName).toBe('http_fetch');
    expect(requested.input).toEqual({ url: 'https://example.com/' });

    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.run.status).toBe('awaiting_approval');
    expect(snapshot.plan?.steps.find((s) => s.id === 'work')?.status).toBe('waiting_approval');
    expect(snapshot.approvals[0]).toMatchObject({ id: requested.approvalId, status: 'pending' });

    // Wrong id and malformed body are rejected without touching the run.
    expect(
      (await post(h, `/api/runs/${runId}/approvals/apr_nope`, { approved: true })).status,
    ).toBe(409);
    expect((await post(h, `/api/runs/${runId}/approvals/${requested.approvalId}`, {})).status).toBe(
      400,
    );

    const ok = await post(h, `/api/runs/${runId}/approvals/${requested.approvalId}`, {
      approved: true,
    });
    expect(ok.status).toBe(200);
    // A second answer for the same approval is rejected.
    expect(
      (await post(h, `/api/runs/${runId}/approvals/${requested.approvalId}`, { approved: false }))
        .status,
    ).toBe(409);

    await res.text();
    const events = await h.collectEvents(runId);
    const resolved = events.find((e) => e.type === 'approval.resolved');
    expect(resolved).toMatchObject({ approvalId: requested.approvalId, approved: true });
    const toolResult = events.find((e) => e.type === 'tool.result' && e.toolName === 'http_fetch');
    // The real tool ran (network may be unavailable in CI, so only assert it produced output).
    expect(toolResult).toBeDefined();
    const statuses = events.filter((e) => e.type === 'run.status').map((e) => e.status);
    expect(statuses).toContain('awaiting_approval');
    expect(statuses.indexOf('awaiting_approval')).toBeLessThan(statuses.lastIndexOf('executing'));
    expect(h.ctx.runManager.get(runId)!.approvals[0]?.status).toBe('approved');
  }, 15_000);

  it('returns a denial to the model instead of running the tool', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;
    const { runId, res } = await h.startRun('抓取 https://example.com/ 的网页');
    const requested = await waitForEvent(h, runId, 'approval.requested');

    const denied = await post(h, `/api/runs/${runId}/approvals/${requested.approvalId}`, {
      approved: false,
      reason: '不允许访问外网',
    });
    expect(denied.status).toBe(200);
    await res.text();
    const events = await h.collectEvents(runId);

    const toolResult = events.find((e) => e.type === 'tool.result' && e.toolName === 'http_fetch');
    if (toolResult?.type !== 'tool.result') throw new Error('unreachable');
    expect(toolResult.output).toMatchObject({ denied: true });
    expect(String((toolResult.output as { error: string }).error)).toContain('不允许访问外网');

    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.approvals[0]).toMatchObject({ status: 'denied', resolution: '不允许访问外网' });
    // The mock executor reports the step as failed after a denial.
    expect(snapshot.plan?.steps.find((s) => s.id === 'work')?.status).toBe('failed');
    expect(snapshot.run.status).toBe('failed');
  }, 15_000);

  it('skips approval when the run auto-approves tools', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;
    const { runId, res } = await h.startRun('抓取 https://example.com/ 的网页', {
      toolPolicy: { autoApprove: true },
    });
    await res.text();
    const events = await h.collectEvents(runId);
    expect(events.some((e) => e.type === 'approval.requested')).toBe(false);
    expect(events.some((e) => e.type === 'tool.result' && e.toolName === 'http_fetch')).toBe(true);
  }, 15_000);
});

describe('HITL: ask_user', () => {
  it('pauses on ask_user and resumes with the answer in the executor context', async () => {
    let seenAnswer = false;
    const script: MockScript = (ctx) => {
      if (ctx.role === 'executor' && ctx.transcript.includes('"answer":"详细报告"'))
        seenAnswer = true;
      return defaultMockScript(ctx);
    };
    const h = await createTestHarness({ script });
    cleanup = h.cleanup;
    const { runId, res } = await h.startRun('先问我偏好，再写一份总结');

    const asked = await waitForEvent(h, runId, 'user_question.asked');
    expect(asked.question).toContain('风格');
    expect(asked.options).toEqual(['简洁摘要', '详细报告']);
    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.run.status).toBe('awaiting_user');
    expect(snapshot.plan?.steps[0]?.status).toBe('waiting_user');

    expect((await post(h, `/api/runs/${runId}/questions/${asked.questionId}`, {})).status).toBe(
      400,
    );
    const answered = await post(h, `/api/runs/${runId}/questions/${asked.questionId}`, {
      answer: '详细报告',
    });
    expect(answered.status).toBe(200);

    await res.text();
    const events = await h.collectEvents(runId);
    expect(events.find((e) => e.type === 'user_question.answered')).toMatchObject({
      questionId: asked.questionId,
      answer: '详细报告',
    });
    expect(seenAnswer).toBe(true);
    const final = h.ctx.runManager.get(runId)!;
    expect(final.run.status).toBe('succeeded');
    expect(final.questions[0]).toMatchObject({ answer: '详细报告' });
  }, 15_000);
});

describe('HITL: plan confirmation (plan_first)', () => {
  it('waits for confirmation and then executes the plan', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;
    const { runId, res } = await h.startRun('plan first', { mode: 'plan_first' });
    await waitForEvent(h, runId, 'plan.created');
    await sleep(20);
    expect(h.ctx.runManager.get(runId)!.run.status).toBe('awaiting_plan_confirmation');

    expect((await post(h, `/api/runs/${runId}/plan/confirm`, { action: 'nope' })).status).toBe(400);
    const ok = await post(h, `/api/runs/${runId}/plan/confirm`, { action: 'confirm' });
    expect(ok.status).toBe(200);

    await res.text();
    await h.collectEvents(runId);
    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.run.status).toBe('succeeded');
    expect(snapshot.plan?.revision).toBe(1);
  });

  it('accepts an edited plan (validated) and records it as revision 2', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;
    const { runId, res } = await h.startRun('edit my plan', { mode: 'plan_first' });
    await waitForEvent(h, runId, 'plan.created');
    await sleep(20);

    const invalid = await post(h, `/api/runs/${runId}/plan/confirm`, {
      action: 'edit',
      steps: [
        { id: 'a', title: 'A', goal: 'g', dependsOn: ['missing'], tools: [], acceptance: 'ok' },
      ],
    });
    expect(invalid.status).toBe(400);
    expect(h.ctx.runManager.get(runId)!.run.status).toBe('awaiting_plan_confirmation');

    const edited = await post(h, `/api/runs/${runId}/plan/confirm`, {
      action: 'edit',
      objective: '用户改写的目标',
      steps: [
        {
          id: 'only',
          title: '只做一步',
          goal: '直接完成',
          dependsOn: [],
          tools: [],
          acceptance: 'ok',
        },
        {
          id: 'check',
          title: '复核',
          goal: '复核结果',
          dependsOn: ['only'],
          tools: ['calculator'],
          acceptance: 'ok',
        },
      ],
    });
    expect(edited.status).toBe(200);

    await res.text();
    const events = await h.collectEvents(runId);
    const revised = events.find((e) => e.type === 'plan.revised');
    if (revised?.type !== 'plan.revised') throw new Error('expected plan.revised');
    expect(revised.reason).toBe('Edited by user');
    expect(revised.plan.objective).toBe('用户改写的目标');
    expect(revised.diff.added.sort()).toEqual(['check', 'only']);
    expect(revised.diff.removed.sort()).toEqual(['understand', 'verify', 'work']);

    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.run.status).toBe('succeeded');
    expect(snapshot.plan?.steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      'only:succeeded',
      'check:succeeded',
    ]);
  });

  it('cancels the run when the plan is rejected', async () => {
    const h = await createTestHarness();
    cleanup = h.cleanup;
    const { runId, res } = await h.startRun('reject', { mode: 'plan_first' });
    await waitForEvent(h, runId, 'plan.created');
    await sleep(20);
    const cancelled = await post(h, `/api/runs/${runId}/plan/confirm`, {
      action: 'cancel',
      reason: '换个思路',
    });
    expect(cancelled.status).toBe(200);
    await res.text();
    await h.collectEvents(runId);
    const snapshot = h.ctx.runManager.get(runId)!;
    expect(snapshot.run.status).toBe('cancelled');
    expect(snapshot.run.error).toBe('换个思路');
    expect(h.ctx.runManager.isActive(runId)).toBe(false);
  });
});
