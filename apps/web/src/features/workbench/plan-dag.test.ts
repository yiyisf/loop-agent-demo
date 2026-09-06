import type { Step } from '@loop-agent/shared';
import { describe, expect, it } from 'vitest';
import { layoutSteps } from './plan-dag';

const step = (id: string, dependsOn: string[] = []): Step => ({
  id,
  title: id,
  goal: id,
  dependsOn,
  tools: [],
  acceptance: 'ok',
  status: 'pending',
  attempt: 0,
  revisionIntroduced: 1,
});

describe('layoutSteps', () => {
  it('places dependants below their deepest dependency and siblings side by side', () => {
    const pos = layoutSteps([
      step('a'),
      step('b', ['a']),
      step('c', ['a']),
      step('d', ['b', 'c']),
      step('e', ['a', 'd']),
    ]);
    expect(pos.get('a')!.y).toBe(0);
    expect(pos.get('b')!.y).toBe(pos.get('c')!.y);
    expect(pos.get('b')!.y).toBeGreaterThan(pos.get('a')!.y);
    expect(pos.get('b')!.x).not.toBe(pos.get('c')!.x);
    expect(pos.get('d')!.y).toBeGreaterThan(pos.get('b')!.y);
    // e depends on a and d: it must sit below d, not directly below a.
    expect(pos.get('e')!.y).toBeGreaterThan(pos.get('d')!.y);
  });

  it('tolerates unknown or cyclic dependencies', () => {
    const pos = layoutSteps([step('a', ['b']), step('b', ['a']), step('c', ['ghost'])]);
    expect(pos.size).toBe(3);
    for (const p of pos.values()) expect(Number.isFinite(p.y)).toBe(true);
  });
});
