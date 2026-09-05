import {
  allStepsTerminal,
  blockedByFailure,
  readySteps,
  type Step,
  type StepResult,
} from '@loop-agent/shared';
import { BudgetGuard } from './budget.js';
import {
  BudgetExceededError,
  RunAbortedError,
  type RunContext,
  throwIfAborted,
} from './context.js';
import { errorMessage, executeStep } from './executor.js';
import { finalize } from './finalizer.js';
import { createPlan } from './planner.js';

/**
 * Plan → Execute → Observe loop (serial version). Reads its working state
 * back from the event projection so that events remain the single source of truth.
 */
export class LoopEngine {
  async run(ctx: RunContext): Promise<void> {
    const guard = new BudgetGuard(ctx.budget);
    try {
      ctx.emit({ type: 'run.status', status: 'planning' });
      const plan = await createPlan(ctx);
      ctx.emit({ type: 'plan.created', plan });

      ctx.emit({ type: 'run.status', status: 'executing' });

      while (true) {
        throwIfAborted(ctx.signal);
        guard.assertWithinLimits(ctx.state.run);

        const steps = ctx.state.steps;
        if (allStepsTerminal(steps)) break;

        const blocked = blockedByFailure(steps);
        if (blocked.length > 0) {
          for (const s of blocked) {
            ctx.emit({
              type: 'step.status',
              stepId: s.id,
              status: 'blocked',
              attempt: s.attempt,
              error: 'Upstream step failed',
            });
          }
          continue;
        }

        const ready = readySteps(steps);
        const next = ready[0];
        if (!next) {
          throw new Error('No runnable steps but plan is not complete (scheduler deadlock)');
        }
        await this.runStepWithRetries(ctx, next);
      }

      const currentPlan = ctx.state.plan!;
      const failed = currentPlan.steps.filter(
        (s) => s.status === 'failed' || s.status === 'blocked',
      );

      ctx.emit({ type: 'run.status', status: 'finalizing' });
      const answer = await finalize(ctx, currentPlan);
      ctx.emit({ type: 'final.done', answer });

      if (failed.length > 0) {
        ctx.emit({
          type: 'run.status',
          status: 'failed',
          reason: `${failed.length} step(s) did not complete: ${failed.map((s) => s.id).join(', ')}`,
        });
      } else {
        ctx.emit({ type: 'run.status', status: 'succeeded' });
      }
    } catch (err) {
      this.handleFailure(ctx, err);
    }
  }

  protected handleFailure(ctx: RunContext, err: unknown): void {
    if (err instanceof RunAbortedError || ctx.signal.aborted) {
      const reason =
        ctx.signal.reason instanceof Error ? ctx.signal.reason.message : 'cancelled by user';
      for (const s of ctx.state.steps) {
        if (s.status === 'running' || s.status === 'pending' || s.status === 'ready') {
          ctx.emit({ type: 'step.status', stepId: s.id, status: 'cancelled', attempt: s.attempt });
        }
      }
      ctx.emit({ type: 'run.status', status: 'cancelled', reason });
      return;
    }
    const message = errorMessage(err);
    ctx.logger.error({ err, runId: ctx.run.id }, 'run failed');
    ctx.emit({
      type: 'error',
      message,
      fatal: true,
    });
    ctx.emit({
      type: 'run.status',
      status: 'failed',
      reason: err instanceof BudgetExceededError ? message : `Run failed: ${message}`,
    });
  }

  protected async runStepWithRetries(ctx: RunContext, step: Step): Promise<StepResult> {
    let attempt = step.attempt;
    let lastError: string | undefined;
    while (true) {
      attempt += 1;
      ctx.emit({ type: 'step.status', stepId: step.id, status: 'running', attempt });
      const started = Date.now();
      let result: StepResult;
      try {
        const current = ctx.state.step(step.id) ?? step;
        result = await executeStep(ctx, ctx.state.plan!, current, {
          attemptNote: lastError
            ? `Previous attempt failed: ${lastError}. Try a different approach.`
            : undefined,
        });
      } catch (err) {
        if (err instanceof RunAbortedError || ctx.signal.aborted) throw err;
        result = { status: 'failed', summary: errorMessage(err), artifacts: [] };
      }

      ctx.emit({
        type: 'log',
        level: 'debug',
        message: `Step ${step.id} attempt ${attempt} ${result.status} in ${Date.now() - started}ms`,
      });

      if (result.status === 'succeeded') {
        ctx.emit({ type: 'step.result', stepId: step.id, result });
        ctx.emit({ type: 'step.status', stepId: step.id, status: 'succeeded', attempt });
        return result;
      }

      lastError = result.summary;
      if (attempt >= ctx.budget.maxAttemptsPerStep) {
        ctx.emit({ type: 'step.result', stepId: step.id, result });
        ctx.emit({
          type: 'step.status',
          stepId: step.id,
          status: 'failed',
          attempt,
          error: result.summary,
        });
        return result;
      }
      ctx.emit({
        type: 'log',
        level: 'warn',
        message: `Step ${step.id} failed (attempt ${attempt}); retrying`,
      });
    }
  }
}
