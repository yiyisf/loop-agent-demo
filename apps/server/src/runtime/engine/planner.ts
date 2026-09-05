import {
  type Plan,
  PlanDraftSchema,
  type Step,
  type StepDraft,
  validateStepGraph,
} from '@loop-agent/shared';
import { generateObject } from 'ai';
import { nowIso } from '../../lib/ids.js';
import { plannerSystemPrompt, plannerUserPrompt } from '../prompts.js';
import { PlanningError, type RunContext, throwIfAborted, toUsage } from './context.js';

export function draftToStep(draft: StepDraft, revision: number): Step {
  return {
    ...draft,
    dependsOn: [...draft.dependsOn],
    tools: [...draft.tools],
    status: 'pending',
    attempt: 0,
    revisionIntroduced: revision,
  };
}

/** Generates the initial plan (revision 1), retrying once with validation feedback. */
export async function createPlan(ctx: RunContext): Promise<Plan> {
  const availableTools = ctx.tools.plannableNames();
  const promptInput = {
    task: ctx.run.input,
    toolsMarkdown: ctx.tools.describeForPlanner(),
    maxSteps: ctx.budget.maxSteps,
    history: ctx.history,
  };
  const model = ctx.models.model('planner', ctx.run.model);

  let errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    throwIfAborted(ctx.signal);
    const result = await generateObject({
      model,
      schema: PlanDraftSchema,
      system: plannerSystemPrompt(promptInput),
      prompt: plannerUserPrompt({ ...promptInput, previousErrors: errors }),
      abortSignal: ctx.signal,
    });
    ctx.emit({ type: 'usage', usage: toUsage(result.usage) });

    const draft = result.object;
    const validation = validateStepGraph(draft.steps, {
      availableTools,
      maxSteps: ctx.budget.maxSteps,
    });
    if (validation.ok) {
      return {
        runId: ctx.run.id,
        revision: 1,
        objective: draft.objective,
        rationale: draft.rationale,
        steps: draft.steps.map((s) => draftToStep(s, 1)),
        createdAt: nowIso(),
      };
    }
    errors = validation.errors;
    ctx.emit({
      type: 'log',
      level: 'warn',
      message: `Plan rejected (attempt ${attempt + 1}): ${errors.join('; ')}`,
    });
  }
  throw new PlanningError(`Planner produced an invalid plan: ${errors.join('; ')}`);
}
