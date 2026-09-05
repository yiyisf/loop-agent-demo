import {
  type Plan,
  type ReflectionDecision,
  ReflectionDecisionSchema,
  type Step,
  type StepResult,
} from '@loop-agent/shared';
import { generateObject } from 'ai';
import { reflectorSystemPrompt, reflectorUserPrompt } from '../prompts.js';
import { type RunContext, throwIfAborted, toUsage } from './context.js';
import { errorMessage } from './executor.js';
import { telemetryFor } from './telemetry.js';

export interface ReflectInput {
  plan: Plan;
  step: Step;
  result: StepResult;
  replansLeft: number;
  notes: string[];
}

/** Asks the model how to proceed after a step; falls back to `continue` on any failure. */
export async function reflect(ctx: RunContext, input: ReflectInput): Promise<ReflectionDecision> {
  throwIfAborted(ctx.signal);
  const promptInput = { ...input, toolsMarkdown: ctx.tools.describeForPlanner() };
  try {
    const result = await generateObject({
      model: ctx.models.model('reflector', ctx.run.model),
      schema: ReflectionDecisionSchema,
      system: reflectorSystemPrompt(promptInput),
      prompt: reflectorUserPrompt(promptInput),
      abortSignal: ctx.signal,
      telemetry: telemetryFor(ctx.config, 'reflector'),
    });
    ctx.emit({ type: 'usage', usage: toUsage(result.usage) });
    return result.object;
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    ctx.emit({
      type: 'log',
      level: 'warn',
      message: `Reflector failed (${errorMessage(err)}); continuing with the current plan`,
    });
    return { action: 'continue', note: 'reflector unavailable' };
  }
}
