import { describe, expect, it } from 'vitest';
import {
  allStepsTerminal,
  blockedByFailure,
  downstreamOf,
  readySteps,
  topologicalOrder,
  validateStepGraph,
} from './dag.js';
import { PlanDraftSchema, type Step, type StepDraft } from './schema/plan.js';

const draft = (id: string, dependsOn: string[] = [], tools: string[] = []): StepDraft => ({
  id,
  title: id,
  goal: `do ${id}`,
  dependsOn,
  tools,
  acceptance: 'done',
});

const step = (id: string, status: Step['status'], dependsOn: string[] = []): Step => ({
  ...draft(id, dependsOn),
  status,
  attempt: 0,
  revisionIntroduced: 1,
});

describe('validateStepGraph', () => {
  it('accepts a valid DAG', () => {
    const result = validateStepGraph([draft('a'), draft('b', ['a']), draft('c', ['a', 'b'])]);
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('rejects duplicate ids, unknown deps and self deps', () => {
    const result = validateStepGraph([draft('a'), draft('a', ['zzz']), draft('b', ['b'])]);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/Duplicate step id "a"/);
    expect(result.errors.join('\n')).toMatch(/unknown step "zzz"/);
    expect(result.errors.join('\n')).toMatch(/depends on itself/);
  });

  it('detects cycles', () => {
    const result = validateStepGraph([draft('a', ['c']), draft('b', ['a']), draft('c', ['b'])]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/cycle/i);
  });

  it('reports unknown tools when a tool set is provided', () => {
    const result = validateStepGraph([draft('a', [], ['web_search', 'nope'])], {
      availableTools: new Set(['web_search']),
    });
    expect(result.errors).toEqual(['Step "a" references unknown tool "nope"']);
  });

  it('enforces max steps', () => {
    const result = validateStepGraph([draft('a'), draft('b')], { maxSteps: 1 });
    expect(result.errors[0]).toMatch(/Too many steps/);
  });
});

describe('topologicalOrder / readySteps', () => {
  it('orders dependencies first', () => {
    const order = topologicalOrder([draft('c', ['b']), draft('b', ['a']), draft('a')]);
    expect(order.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('computes ready steps from satisfied dependencies', () => {
    const steps = [
      step('a', 'succeeded'),
      step('b', 'pending', ['a']),
      step('c', 'pending', ['b']),
      step('d', 'pending'),
      step('e', 'pending', ['skipped-one']),
      step('skipped-one', 'skipped'),
    ];
    expect(readySteps(steps).map((s) => s.id)).toEqual(['d', 'b', 'e']);
  });

  it('detects terminal completion and failure blocking', () => {
    const steps = [
      step('a', 'failed'),
      step('b', 'pending', ['a']),
      step('c', 'pending', ['b']),
      step('d', 'succeeded'),
    ];
    expect(allStepsTerminal(steps)).toBe(false);
    expect([...downstreamOf(steps, ['a'])].sort()).toEqual(['b', 'c']);
    expect(blockedByFailure(steps).map((s) => s.id)).toEqual(['b', 'c']);
    expect(allStepsTerminal([step('x', 'succeeded'), step('y', 'skipped')])).toBe(true);
  });
});

describe('PlanDraftSchema', () => {
  it('applies defaults', () => {
    const parsed = PlanDraftSchema.parse({
      objective: 'x',
      steps: [{ id: 'a', title: 'A', goal: 'g', acceptance: 'ok' }],
    });
    expect(parsed.steps[0]?.dependsOn).toEqual([]);
    expect(parsed.steps[0]?.tools).toEqual([]);
  });

  it('rejects invalid step ids', () => {
    const result = PlanDraftSchema.safeParse({
      objective: 'x',
      steps: [{ id: 'Bad Id', title: 'A', goal: 'g', acceptance: 'ok' }],
    });
    expect(result.success).toBe(false);
  });
});
