import { tool } from 'ai';
import { all, create } from 'mathjs';
import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const math = create(all!);
// Keep a reference to the unrestricted evaluate before disabling the
// dangerous functions on the instance (mathjs recommended sandboxing pattern).
const limitedEvaluate = math.evaluate;
const forbidden = () => {
  throw new Error('Function is disabled in this sandbox');
};
math.import(
  {
    import: forbidden,
    createUnit: forbidden,
    reviver: forbidden,
    evaluate: forbidden,
    parse: forbidden,
    simplify: forbidden,
    derivative: forbidden,
    resolve: forbidden,
    compile: forbidden,
  },
  { override: true },
);

export function safeEvaluate(expression: string): unknown {
  if (expression.length > 500) throw new Error('Expression too long');
  const scope = new Map<string, unknown>();
  return limitedEvaluate(expression, scope);
}

export const calculatorTool: ToolDefinition = {
  name: 'calculator',
  description:
    'Evaluate math expressions precisely (arithmetic, percentages, unit conversion, statistics). Use instead of mental math.',
  risk: 'low',
  category: 'compute',
  plannable: true,
  create: () =>
    tool({
      description:
        'Evaluate a mathematical expression using mathjs syntax, e.g. "(12 + 30) * 2", "sqrt(16) + 2^3", "mean([1,2,3])", "5 km to miles".',
      inputSchema: z.object({ expression: z.string().min(1).max(500) }),
      execute: async ({ expression }) => {
        try {
          const result = safeEvaluate(expression);
          return { expression, result: math.format(result, { precision: 14 }) };
        } catch (err) {
          return { expression, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
};
