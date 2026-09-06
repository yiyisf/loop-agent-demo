import { describe, expect, it } from 'vitest';
import { estimateCost, formatUsd, lookupModelRates } from './pricing.js';
import { emptyUsage } from './schema/common.js';

describe('lookupModelRates', () => {
  it('matches the longest prefix and dated model ids', () => {
    expect(lookupModelRates('gpt-4.1-mini-2025-04-14')).toMatchObject({
      rateKey: 'gpt-4.1-mini',
      matched: true,
    });
    expect(lookupModelRates('claude-sonnet-4-20250514')).toMatchObject({
      rateKey: 'claude-sonnet-4',
      matched: true,
    });
    expect(lookupModelRates('mock')).toEqual({
      rates: { inputPerMTok: 0, outputPerMTok: 0 },
      rateKey: 'mock',
      matched: true,
    });
  });

  it('falls back to gpt-4.1 for unknown or missing ids', () => {
    expect(lookupModelRates(undefined).matched).toBe(false);
    expect(lookupModelRates('llama-3-70b').rateKey).toBe('gpt-4.1');
    expect(lookupModelRates('llama-3-70b').matched).toBe(false);
  });
});

describe('estimateCost', () => {
  it('computes USD from token counts', () => {
    const usage = { ...emptyUsage(), inputTokens: 1_000_000, outputTokens: 500_000 };
    const cost = estimateCost(usage, 'gpt-4.1');
    expect(cost.usd).toBeCloseTo(2 + 4, 6);
    expect(cost.matched).toBe(true);
  });

  it('is zero for the mock model', () => {
    const usage = { ...emptyUsage(), inputTokens: 12_000, outputTokens: 3_000 };
    expect(estimateCost(usage, 'mock').usd).toBe(0);
  });
});

describe('formatUsd', () => {
  it('picks a readable precision', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(0.04)).toBe('$0.040');
    expect(formatUsd(1.2)).toBe('$1.20');
  });
});
