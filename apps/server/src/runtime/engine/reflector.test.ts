import { describe, expect, it } from 'vitest';
import { hasUncertaintySignal } from './reflector.js';

describe('hasUncertaintySignal', () => {
  it('flags hedged or incomplete summaries', () => {
    expect(hasUncertaintySignal('Collected 3 sources but could not verify the pricing.')).toBe(
      true,
    );
    expect(hasUncertaintySignal('Partially completed: two of three docs fetched.')).toBe(true);
    expect(hasUncertaintySignal('已整理候选库，但部分完成，官方文档未找到。')).toBe(true);
    expect(hasUncertaintySignal('Assuming the API is v2, the result is 42.')).toBe(true);
  });

  it('accepts confident summaries', () => {
    expect(hasUncertaintySignal('Computed (12+30)*2 = 84 and explained each step.')).toBe(false);
    expect(hasUncertaintySignal('已列出三个库的对比表格与选型建议。')).toBe(false);
  });
});
