import { validateStepGraph } from './dag.js';
import type { Plan, PlanDiff, PlanPatchOp, Step, StepDraft } from './schema/plan.js';

export interface ApplyPlanPatchOptions {
  availableTools?: ReadonlySet<string>;
  maxSteps?: number;
}

export type ApplyPlanPatchResult =
  | { ok: true; plan: Plan; diff: PlanDiff }
  | { ok: false; errors: string[] };

const IMMUTABLE: ReadonlySet<Step['status']> = new Set([
  'running',
  'succeeded',
  'waiting_approval',
  'waiting_user',
]);

/**
 * Applies reflection patch ops to a plan, producing the next revision.
 * Running/succeeded steps are immutable; failed or blocked steps that are
 * updated become runnable again; blocked steps are re-evaluated by the scheduler.
 */
export function applyPlanPatch(
  plan: Plan,
  ops: readonly PlanPatchOp[],
  now: string,
  options: ApplyPlanPatchOptions = {},
): ApplyPlanPatchResult {
  const revision = plan.revision + 1;
  const errors: string[] = [];
  const steps: Step[] = plan.steps.map((s) => structuredClone(s));
  const diff: PlanDiff = { added: [], updated: [], removed: [] };
  const byId = () => new Map(steps.map((s) => [s.id, s]));

  for (const op of ops) {
    switch (op.op) {
      case 'add': {
        if (byId().has(op.step.id)) {
          errors.push(`Cannot add step "${op.step.id}": id already exists`);
          break;
        }
        const added: Step = {
          ...op.step,
          dependsOn: [...op.step.dependsOn],
          tools: [...op.step.tools],
          status: 'pending',
          attempt: 0,
          revisionIntroduced: revision,
        };
        const anchor = op.after ? steps.findIndex((s) => s.id === op.after) : -1;
        if (op.after && anchor === -1) {
          errors.push(`Cannot add step "${op.step.id}" after unknown step "${op.after}"`);
          break;
        }
        if (anchor === -1) steps.push(added);
        else steps.splice(anchor + 1, 0, added);
        diff.added.push(op.step.id);
        break;
      }
      case 'update': {
        const step = byId().get(op.stepId);
        if (!step) {
          errors.push(`Cannot update unknown step "${op.stepId}"`);
          break;
        }
        if (IMMUTABLE.has(step.status)) {
          errors.push(`Cannot update step "${op.stepId}" while it is ${step.status}`);
          break;
        }
        const changes: Partial<StepDraft> = op.changes;
        if (changes.title !== undefined) step.title = changes.title;
        if (changes.goal !== undefined) step.goal = changes.goal;
        if (changes.acceptance !== undefined) step.acceptance = changes.acceptance;
        if (changes.dependsOn !== undefined) step.dependsOn = [...changes.dependsOn];
        if (changes.tools !== undefined) step.tools = [...changes.tools];
        if (step.status === 'failed' || step.status === 'blocked' || step.status === 'skipped') {
          step.status = 'pending';
          step.attempt = 0;
          step.error = undefined;
          step.result = undefined;
          step.startedAt = undefined;
          step.endedAt = undefined;
        }
        if (!diff.updated.includes(step.id)) diff.updated.push(step.id);
        break;
      }
      case 'remove': {
        const idx = steps.findIndex((s) => s.id === op.stepId);
        const step = steps[idx];
        if (!step) {
          errors.push(`Cannot remove unknown step "${op.stepId}"`);
          break;
        }
        if (IMMUTABLE.has(step.status)) {
          errors.push(`Cannot remove step "${op.stepId}" while it is ${step.status}`);
          break;
        }
        steps.splice(idx, 1);
        diff.removed.push(step.id);
        break;
      }
    }
  }

  // Steps blocked by a failure get another chance if the failure was addressed.
  for (const s of steps) {
    if (s.status === 'blocked') {
      s.status = 'pending';
      s.error = undefined;
    }
  }

  // Dependencies on removed steps are dropped for pending steps.
  const ids = new Set(steps.map((s) => s.id));
  for (const s of steps) {
    if (s.status === 'pending' && s.dependsOn.some((d) => !ids.has(d))) {
      s.dependsOn = s.dependsOn.filter((d) => ids.has(d));
      if (!diff.updated.includes(s.id) && !diff.added.includes(s.id)) diff.updated.push(s.id);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const validation = validateStepGraph(steps, options);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  // Succeeded steps cannot depend on something that has not run: if a patch
  // re-opened an upstream step, the dependants would be inconsistent.
  for (const s of steps) {
    if (s.status !== 'succeeded') continue;
    for (const d of s.dependsOn) {
      const dep = steps.find((x) => x.id === d);
      if (dep && dep.status !== 'succeeded' && dep.status !== 'skipped') {
        return {
          ok: false,
          errors: [`Succeeded step "${s.id}" would depend on unfinished step "${d}"`],
        };
      }
    }
  }

  return {
    ok: true,
    diff,
    plan: { ...plan, revision, steps, createdAt: now },
  };
}
