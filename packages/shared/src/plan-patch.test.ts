import { describe, expect, it } from 'vitest';
import { applyPlanPatch } from './plan-patch.js';
import type { Plan, Step } from './schema/plan.js';

const step = (id: string, status: Step['status'], dependsOn: string[] = []): Step => ({
  id,
  title: id,
  goal: `do ${id}`,
  dependsOn,
  tools: [],
  acceptance: 'ok',
  status,
  attempt: status === 'pending' ? 0 : 1,
  revisionIntroduced: 1,
});

const plan = (): Plan => ({
  runId: 'r',
  revision: 1,
  objective: 'o',
  createdAt: 't0',
  steps: [
    step('a', 'succeeded'),
    step('b', 'failed', ['a']),
    step('c', 'blocked', ['b']),
    step('d', 'pending'),
  ],
});

describe('applyPlanPatch', () => {
  it('adds, updates and removes steps and bumps the revision', () => {
    const res = applyPlanPatch(
      plan(),
      [
        { op: 'update', stepId: 'b', changes: { goal: 'retry differently', tools: [] } },
        {
          op: 'add',
          step: { id: 'e', title: 'E', goal: 'g', dependsOn: ['b'], tools: [], acceptance: 'ok' },
        },
        { op: 'remove', stepId: 'd' },
      ],
      't1',
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.revision).toBe(2);
    expect(res.diff).toEqual({ added: ['e'], updated: ['b'], removed: ['d'] });
    const b = res.plan.steps.find((s) => s.id === 'b')!;
    expect(b.status).toBe('pending');
    expect(b.attempt).toBe(0);
    expect(b.goal).toBe('retry differently');
    expect(res.plan.steps.find((s) => s.id === 'c')?.status).toBe('pending');
    expect(res.plan.steps.find((s) => s.id === 'e')?.revisionIntroduced).toBe(2);
    expect(res.plan.steps.map((s) => s.id)).toEqual(['a', 'b', 'c', 'e']);
  });

  it('refuses to touch running or succeeded steps', () => {
    const res = applyPlanPatch(plan(), [{ op: 'remove', stepId: 'a' }], 't1');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toMatch(/while it is succeeded/);
  });

  it('drops dependencies on removed steps and validates the graph', () => {
    const res = applyPlanPatch(
      plan(),
      [
        { op: 'remove', stepId: 'b' },
        { op: 'update', stepId: 'c', changes: { goal: 'do c without b' } },
      ],
      't1',
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.steps.find((s) => s.id === 'c')?.dependsOn).toEqual([]);
  });

  it('rejects unknown tools and cycles', () => {
    const bad = applyPlanPatch(
      plan(),
      [
        {
          op: 'add',
          step: {
            id: 'x',
            title: 'x',
            goal: 'g',
            dependsOn: [],
            tools: ['nope'],
            acceptance: 'ok',
          },
        },
      ],
      't1',
      { availableTools: new Set(['calculator']) },
    );
    expect(bad.ok).toBe(false);
    const cyc = applyPlanPatch(
      plan(),
      [{ op: 'update', stepId: 'd', changes: { dependsOn: ['d'] } }],
      't1',
    );
    expect(cyc.ok).toBe(false);
  });
});
