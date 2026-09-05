import { type Step, type StepDraft, TERMINAL_STEP_STATUSES } from './schema/plan.js';

export interface DagValidationOptions {
  /** Known tool names; when provided, unknown tools are reported. */
  availableTools?: ReadonlySet<string>;
  maxSteps?: number;
}

export interface DagValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validates a set of step drafts as a DAG: unique ids, existing dependencies,
 * no self-dependency, no cycles, and (optionally) known tools.
 */
export function validateStepGraph(
  steps: readonly StepDraft[],
  options: DagValidationOptions = {},
): DagValidationResult {
  const errors: string[] = [];
  const ids = new Set<string>();

  if (options.maxSteps !== undefined && steps.length > options.maxSteps) {
    errors.push(`Too many steps: ${steps.length} > ${options.maxSteps}`);
  }

  for (const step of steps) {
    if (ids.has(step.id)) errors.push(`Duplicate step id "${step.id}"`);
    ids.add(step.id);
  }

  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (dep === step.id) errors.push(`Step "${step.id}" depends on itself`);
      else if (!ids.has(dep)) errors.push(`Step "${step.id}" depends on unknown step "${dep}"`);
    }
    if (options.availableTools) {
      for (const tool of step.tools) {
        if (!options.availableTools.has(tool)) {
          errors.push(`Step "${step.id}" references unknown tool "${tool}"`);
        }
      }
    }
  }

  if (errors.length === 0) {
    const cycle = findCycle(steps);
    if (cycle) errors.push(`Dependency cycle detected: ${cycle.join(' -> ')}`);
  }

  return { ok: errors.length === 0, errors };
}

function findCycle(steps: readonly StepDraft[]): string[] | null {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const s = state.get(id);
    if (s === 'done') return null;
    if (s === 'visiting') {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dep)) continue;
      const found = visit(dep);
      if (found) return found;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };

  for (const step of steps) {
    const found = visit(step.id);
    if (found) return found;
  }
  return null;
}

/** Returns steps in a valid topological order (dependencies first). */
export function topologicalOrder<T extends StepDraft>(steps: readonly T[]): T[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const s of steps) {
    indegree.set(s.id, s.dependsOn.filter((d) => byId.has(d)).length);
    for (const d of s.dependsOn) {
      if (!dependents.has(d)) dependents.set(d, []);
      dependents.get(d)!.push(s.id);
    }
  }
  const queue = steps.filter((s) => indegree.get(s.id) === 0).map((s) => s.id);
  const out: T[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(byId.get(id)!);
    for (const dep of dependents.get(id) ?? []) {
      const n = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, n);
      if (n === 0) queue.push(dep);
    }
  }
  return out;
}

const satisfies = (status: Step['status']) => status === 'succeeded' || status === 'skipped';

/** Steps whose dependencies are all satisfied and which have not started yet. */
export function readySteps(steps: readonly Step[]): Step[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  return topologicalOrder(steps).filter(
    (s) =>
      (s.status === 'pending' || s.status === 'ready') &&
      s.dependsOn.every((d) => {
        const dep = byId.get(d);
        return dep ? satisfies(dep.status) : true;
      }),
  );
}

export function allStepsTerminal(steps: readonly Step[]): boolean {
  return steps.every((s) => TERMINAL_STEP_STATUSES.has(s.status));
}

/** Transitive dependents of the given step ids. */
export function downstreamOf(steps: readonly Step[], rootIds: readonly string[]): Set<string> {
  const result = new Set<string>();
  const queue = [...rootIds];
  while (queue.length) {
    const id = queue.shift()!;
    for (const s of steps) {
      if (s.dependsOn.includes(id) && !result.has(s.id)) {
        result.add(s.id);
        queue.push(s.id);
      }
    }
  }
  return result;
}

/** Pending steps that can never run because an upstream step failed/was blocked. */
export function blockedByFailure(steps: readonly Step[]): Step[] {
  const failed = steps
    .filter((s) => s.status === 'failed' || s.status === 'blocked')
    .map((s) => s.id);
  const downstream = downstreamOf(steps, failed);
  return steps.filter((s) => downstream.has(s.id) && !TERMINAL_STEP_STATUSES.has(s.status));
}
