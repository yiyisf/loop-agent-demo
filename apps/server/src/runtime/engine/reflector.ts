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

export interface ReflectOptions {
  /** Always consult the model after successful steps (costs one call per step). */
  llmOnSuccess?: boolean;
}

/**
 * Phrases in a step summary suggesting the executor was not confident in its
 * result. Only these (and failures) justify spending an LLM call on reflection.
 */
const UNCERTAINTY_SIGNALS =
  /\b(unable|could ?n[o']t|cannot|not (?:found|available|accessible)|unclear|uncertain|unsure|partial(?:ly)?|incomplete|assum(?:e|ed|ing|ption)|guess|unverified|may not|might not)\b|无法|未能|不确定|不清楚|未找到|不可用|部分(?:完成|成功)|不完整|假设|猜测|可能不|尚未|待确认/i;

export function hasUncertaintySignal(summary: string): boolean {
  return UNCERTAINTY_SIGNALS.test(summary);
}

/**
 * Lightweight rule used for confident successes: the executor already
 * self-assessed the acceptance criteria via `finish_step`, so the plan proceeds.
 */
function ruleBasedDecision(): ReflectionDecision {
  return { action: 'continue', note: 'rule: step succeeded with a confident summary' };
}

/**
 * Decides how to proceed after a step. Failed steps and successes whose summary
 * carries uncertainty signals are reflected on by the model; other successes use
 * the rule-based shortcut (ADR D8). Falls back to `continue` on model errors.
 */
export async function reflect(
  ctx: RunContext,
  input: ReflectInput,
  options: ReflectOptions = {},
): Promise<ReflectionDecision> {
  throwIfAborted(ctx.signal);
  const needsModel =
    input.result.status === 'failed' ||
    options.llmOnSuccess === true ||
    hasUncertaintySignal(input.result.summary);
  if (!needsModel) return ruleBasedDecision();

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
