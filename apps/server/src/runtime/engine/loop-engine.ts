import {
  allStepsTerminal,
  applyPlanPatch,
  blockedByFailure,
  type Plan,
  type ReflectionDecision,
  readySteps,
  type Step,
  type StepResult,
  validateStepGraph,
} from '@loop-agent/shared';
import { nowIso } from '../../lib/ids.js';
import { BudgetGuard } from './budget.js';
import {
  BudgetExceededError,
  PlanningError,
  RunAbortedError,
  type RunContext,
  throwIfAborted,
} from './context.js';
import { errorMessage, executeStep } from './executor.js';
import { finalize } from './finalizer.js';
import { askUser, awaitPlanConfirmation } from './hitl.js';
import { createPlan, draftToStep } from './planner.js';
import { reflect } from './reflector.js';

export interface LoopEngineOptions {
  /** Run the reflector after successful steps too (not only after failures). */
  reflectOnSuccess?: boolean;
}

interface StepOutcome {
  step: Step;
  result: StepResult;
}

/**
 * Plan → Execute (parallel, DAG-driven) → Reflect → Replan loop. Working state
 * is always read back from the event projection so events stay authoritative.
 */
export class LoopEngine {
  constructor(private readonly options: LoopEngineOptions = {}) {}

  async run(ctx: RunContext): Promise<void> {
    const guard = new BudgetGuard(ctx.budget);
    try {
      ctx.emit({ type: 'run.status', status: 'planning' });
      const plan = await createPlan(ctx);
      ctx.emit({ type: 'plan.created', plan });

      if (ctx.run.mode === 'plan_first') {
        const proceed = await this.confirmPlan(ctx);
        if (!proceed) return;
      }

      ctx.emit({ type: 'run.status', status: 'executing' });
      await this.executeLoop(ctx, guard);

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

  /** Returns false when the user cancelled the run at confirmation time. */
  private async confirmPlan(ctx: RunContext): Promise<boolean> {
    const decision = await awaitPlanConfirmation(ctx);
    if (decision.action === 'cancel') {
      ctx.emit({
        type: 'run.status',
        status: 'cancelled',
        reason: decision.reason ?? 'Plan rejected by user',
      });
      return false;
    }
    if (decision.action === 'edit') {
      const validation = validateStepGraph(decision.steps, {
        availableTools: ctx.tools.plannableNames(),
        maxSteps: ctx.budget.maxSteps,
      });
      if (!validation.ok)
        throw new PlanningError(`Edited plan is invalid: ${validation.errors.join('; ')}`);
      const previous = ctx.state.plan!;
      const revision = previous.revision + 1;
      const plan: Plan = {
        ...previous,
        revision,
        objective: decision.objective ?? previous.objective,
        steps: decision.steps.map((s) => draftToStep(s, revision)),
        createdAt: nowIso(),
      };
      const prevIds = new Set(previous.steps.map((s) => s.id));
      const nextIds = new Set(plan.steps.map((s) => s.id));
      ctx.emit({
        type: 'plan.revised',
        plan,
        reason: 'Edited by user',
        diff: {
          added: plan.steps.filter((s) => !prevIds.has(s.id)).map((s) => s.id),
          updated: plan.steps.filter((s) => prevIds.has(s.id)).map((s) => s.id),
          removed: previous.steps.filter((s) => !nextIds.has(s.id)).map((s) => s.id),
        },
      });
    }
    return true;
  }

  private async executeLoop(ctx: RunContext, guard: BudgetGuard): Promise<void> {
    const running = new Map<string, Promise<StepOutcome>>();
    let finishEarly = false;

    try {
      while (true) {
        throwIfAborted(ctx.signal);
        guard.assertWithinLimits(ctx.state.run);

        let steps = ctx.state.steps;

        if (finishEarly) {
          for (const s of steps) {
            if ((s.status === 'pending' || s.status === 'ready') && !running.has(s.id)) {
              ctx.emit({
                type: 'step.status',
                stepId: s.id,
                status: 'skipped',
                attempt: s.attempt,
              });
            }
          }
          steps = ctx.state.steps;
        }

        for (const s of blockedByFailure(steps)) {
          if (running.has(s.id)) continue;
          ctx.emit({
            type: 'step.status',
            stepId: s.id,
            status: 'blocked',
            attempt: s.attempt,
            error: 'Upstream step failed',
          });
        }
        steps = ctx.state.steps;

        if (running.size === 0 && allStepsTerminal(steps)) break;

        const ready = readySteps(steps).filter((s) => !running.has(s.id));
        while (running.size < ctx.budget.maxParallel && ready.length > 0) {
          const step = ready.shift()!;
          running.set(
            step.id,
            this.runStepWithRetries(ctx, step).then((result) => ({ step, result })),
          );
        }

        if (running.size === 0) {
          if (allStepsTerminal(ctx.state.steps)) break;
          throw new Error('No runnable steps but plan is not complete (scheduler deadlock)');
        }

        const outcome = await Promise.race(running.values());
        running.delete(outcome.step.id);

        const remaining = ctx.state.steps.filter(
          (s) => s.status === 'pending' || s.status === 'ready',
        );
        const shouldReflect =
          outcome.result.status === 'failed' ||
          ((this.options.reflectOnSuccess ?? true) && remaining.length > 0);
        if (!shouldReflect) continue;

        const decision = await reflect(ctx, {
          plan: ctx.state.plan!,
          step: ctx.state.step(outcome.step.id) ?? outcome.step,
          result: outcome.result,
          replansLeft: ctx.budget.maxReplans - guard.replans,
          notes: ctx.notes,
        });
        ctx.emit({ type: 'reflection', stepId: outcome.step.id, decision });
        finishEarly = (await this.applyDecision(ctx, guard, decision, outcome)) || finishEarly;
      }
    } finally {
      // Never leave step promises dangling (e.g. after abort).
      await Promise.allSettled(running.values());
    }
  }

  /** Applies a reflection decision; returns true when the run should finish early. */
  private async applyDecision(
    ctx: RunContext,
    guard: BudgetGuard,
    decision: ReflectionDecision,
    outcome: StepOutcome,
  ): Promise<boolean> {
    switch (decision.action) {
      case 'continue':
        return false;
      case 'finish_early':
        ctx.emit({ type: 'log', level: 'info', message: `Finishing early: ${decision.reason}` });
        return true;
      case 'ask_user': {
        await askUser(ctx, outcome.step.id, decision.question, decision.options);
        return false;
      }
      case 'replan': {
        if (!guard.canReplan()) {
          ctx.emit({
            type: 'log',
            level: 'warn',
            message: `Replan requested but budget exhausted (${ctx.budget.maxReplans}); continuing`,
          });
          return false;
        }
        ctx.emit({ type: 'run.status', status: 'replanning' });
        const patched = applyPlanPatch(ctx.state.plan!, decision.patch, nowIso(), {
          availableTools: ctx.tools.plannableNames(),
          maxSteps: ctx.budget.maxSteps,
        });
        if (!patched.ok) {
          ctx.emit({
            type: 'log',
            level: 'warn',
            message: `Replan patch rejected: ${patched.errors.join('; ')}`,
          });
          ctx.emit({ type: 'run.status', status: 'executing' });
          return false;
        }
        guard.noteReplan();
        ctx.emit({
          type: 'plan.revised',
          plan: patched.plan,
          diff: patched.diff,
          reason: decision.reason,
        });
        ctx.emit({ type: 'run.status', status: 'executing' });
        return false;
      }
    }
  }

  protected handleFailure(ctx: RunContext, err: unknown): void {
    if (err instanceof RunAbortedError || ctx.signal.aborted) {
      const reason =
        ctx.signal.reason instanceof Error ? ctx.signal.reason.message : 'cancelled by user';
      for (const s of ctx.state.steps) {
        if (
          s.status === 'running' ||
          s.status === 'pending' ||
          s.status === 'ready' ||
          s.status === 'waiting_user' ||
          s.status === 'waiting_approval'
        ) {
          ctx.emit({ type: 'step.status', stepId: s.id, status: 'cancelled', attempt: s.attempt });
        }
      }
      ctx.emit({ type: 'run.status', status: 'cancelled', reason });
      return;
    }
    const message = errorMessage(err);
    ctx.logger.error({ err, runId: ctx.run.id }, 'run failed');
    ctx.emit({ type: 'error', message, fatal: true });
    ctx.emit({
      type: 'run.status',
      status: 'failed',
      reason: err instanceof BudgetExceededError ? message : `Run failed: ${message}`,
    });
  }

  /** Runs a step with retries; never rejects except when the run is aborted. */
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
