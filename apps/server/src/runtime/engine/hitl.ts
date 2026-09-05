import type { PlanConfirmation, RunStatus } from '@loop-agent/shared';
import { newId } from '../../lib/ids.js';
import type { RunContext } from './context.js';

export const waitKeys = {
  question: (id: string) => `question:${id}`,
  approval: (id: string) => `approval:${id}`,
  planConfirmation: 'plan_confirmation',
} as const;

/**
 * Emits a question to the user, pauses the run and resolves with the answer.
 * `stepId` is "reflector" when the question originates from reflection.
 */
export async function askUser(
  ctx: RunContext,
  stepId: string,
  question: string,
  options?: string[],
): Promise<string> {
  const questionId = newId('q');
  const previous: RunStatus = ctx.state.run.status;
  const step = ctx.state.step(stepId);
  ctx.emit({ type: 'user_question.asked', questionId, stepId, question, options });
  ctx.emit({ type: 'run.status', status: 'awaiting_user' });
  if (step)
    ctx.emit({ type: 'step.status', stepId, status: 'waiting_user', attempt: step.attempt });
  try {
    const answer = await ctx.waitFor<string>(waitKeys.question(questionId));
    ctx.emit({ type: 'user_question.answered', questionId, answer });
    ctx.notes.push(`Q: ${question}\nA: ${answer}`);
    return answer;
  } finally {
    if (!ctx.signal.aborted) {
      if (step) ctx.emit({ type: 'step.status', stepId, status: 'running', attempt: step.attempt });
      ctx.emit({
        type: 'run.status',
        status: previous === 'awaiting_user' ? 'executing' : previous,
      });
    }
  }
}

/** Pauses until the user confirms, edits or cancels the plan. */
export async function awaitPlanConfirmation(ctx: RunContext): Promise<PlanConfirmation> {
  ctx.emit({ type: 'run.status', status: 'awaiting_plan_confirmation' });
  return ctx.waitFor<PlanConfirmation>(waitKeys.planConfirmation);
}
