import type { Usage } from './schema/common.js';

/** USD per 1 million tokens. List prices as of 2026-01; override via env later if needed. */
export interface ModelRates {
  inputPerMTok: number;
  outputPerMTok: number;
}

/**
 * Longest-prefix match wins so `gpt-4.1-mini-2025-04-14` resolves to `gpt-4.1-mini`.
 * `mock` is free. Unknown ids fall back to `gpt-4.1` and are flagged as approximate.
 */
export const MODEL_RATES: Readonly<Record<string, ModelRates>> = {
  mock: { inputPerMTok: 0, outputPerMTok: 0 },
  'gpt-4.1-nano': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  'gpt-4.1-mini': { inputPerMTok: 0.4, outputPerMTok: 1.6 },
  'gpt-4.1': { inputPerMTok: 2, outputPerMTok: 8 },
  'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 },
  'o4-mini': { inputPerMTok: 1.1, outputPerMTok: 4.4 },
  o3: { inputPerMTok: 10, outputPerMTok: 40 },
  'claude-haiku-4': { inputPerMTok: 0.8, outputPerMTok: 4 },
  'claude-sonnet-4': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-opus-4': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-3-5-haiku': { inputPerMTok: 0.8, outputPerMTok: 4 },
  'claude-3-5-sonnet': { inputPerMTok: 3, outputPerMTok: 15 },
};

export const DEFAULT_MODEL_RATES: ModelRates = MODEL_RATES['gpt-4.1']!;

export interface CostEstimate {
  usd: number;
  inputUsd: number;
  outputUsd: number;
  rates: ModelRates;
  /** The table key that matched, or the fallback key. */
  rateKey: string;
  /** False when the model id was not in the table and we used the fallback. */
  matched: boolean;
}

const RATE_KEYS = Object.keys(MODEL_RATES).sort((a, b) => b.length - a.length);

export function lookupModelRates(modelId: string | undefined): {
  rates: ModelRates;
  rateKey: string;
  matched: boolean;
} {
  const id = (modelId ?? '').trim().toLowerCase();
  if (!id) return { rates: DEFAULT_MODEL_RATES, rateKey: 'gpt-4.1', matched: false };
  const key = RATE_KEYS.find((k) => id === k || id.startsWith(`${k}-`) || id.startsWith(`${k}_`));
  if (key) return { rates: MODEL_RATES[key]!, rateKey: key, matched: true };
  return { rates: DEFAULT_MODEL_RATES, rateKey: 'gpt-4.1', matched: false };
}

export function estimateCost(usage: Usage, modelId?: string): CostEstimate {
  const { rates, rateKey, matched } = lookupModelRates(modelId);
  const inputUsd = (usage.inputTokens / 1_000_000) * rates.inputPerMTok;
  const outputUsd = (usage.outputTokens / 1_000_000) * rates.outputPerMTok;
  return {
    usd: inputUsd + outputUsd,
    inputUsd,
    outputUsd,
    rates,
    rateKey,
    matched,
  };
}

/** Compact USD display: `$0`, `$0.0042`, `$1.23`. */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}
