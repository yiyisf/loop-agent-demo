import type { Plan, Step, StepResult } from '@loop-agent/shared';

export interface PlannerPromptInput {
  task: string;
  toolsMarkdown: string;
  maxSteps: number;
  history?: string;
  previousErrors?: string[];
}

export function plannerSystemPrompt({ toolsMarkdown, maxSteps }: PlannerPromptInput): string {
  return `You are the Planner of an autonomous agent. Decompose the user's task into an executable plan: a small DAG of steps.

Rules:
- Produce between 2 and ${maxSteps} steps. Prefer 3-6 steps of medium granularity: each step should take a focused executor a handful of tool calls.
- Each step has: a short lowercase id (kebab-case), a title, a concrete goal, dependsOn (ids of steps whose results it truly needs), tools (subset of the available tools it may use, may be empty), and an acceptance criterion that can be checked.
- Steps that do not depend on each other must NOT be chained; leave them parallel.
- Do not include a step for "write the final answer to the user" - a separate finalizer does that.
- Only use tools from the list below. If no tools are needed for a step, leave tools empty.
- Write the objective, titles, goals and acceptance criteria in the same language as the user's task.

Available tools:
${toolsMarkdown}`;
}

export function plannerUserPrompt({ task, history, previousErrors }: PlannerPromptInput): string {
  const parts = [`Task:\n${task}`];
  if (history) parts.push(`Conversation context:\n${history}`);
  if (previousErrors?.length) {
    parts.push(
      `Your previous plan was rejected for these reasons; fix them:\n${previousErrors.map((e) => `- ${e}`).join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

export interface ExecutorPromptInput {
  objective: string;
  step: Step;
  upstream: Array<{ step: Step; summary: string; artifacts: string[] }>;
  maxToolCalls: number;
  attemptNote?: string;
  notes?: string[];
}

export function executorSystemPrompt(input: ExecutorPromptInput): string {
  const notes = input.notes?.length
    ? `\n\n## User clarifications\n${input.notes.map((n) => `- ${n.replace(/\n/g, ' ')}`).join('\n')}`
    : '';
  const upstream =
    input.upstream.length === 0
      ? '(none)'
      : input.upstream
          .map(
            (u) =>
              `### ${u.step.title} (${u.step.id})\n${u.summary}${
                u.artifacts.length ? `\nArtifacts: ${u.artifacts.join(', ')}` : ''
              }`,
          )
          .join('\n\n');

  return `You are the Executor of one step in a larger plan. Work only on this step.

Overall objective: ${input.objective}

## Current step
- id: ${input.step.id}
- title: ${input.step.title}
- 目标 / Goal: ${input.step.goal}
- Acceptance: ${input.step.acceptance}

## Results of upstream steps
${upstream}${notes}

## How to work
- Use the available tools when they help; you have at most ${input.maxToolCalls} tool calls.
- Think briefly, act, then verify against the acceptance criterion.
- When done (or if it is impossible), call \`finish_step\` exactly once with status, and a summary that contains the concrete results (facts, numbers, links, decisions) later steps and the final answer will rely on. Do not write the summary as a narrative of what you did; write the findings.
- Respond in the language of the objective.${input.attemptNote ? `\n\n${input.attemptNote}` : ''}`;
}

export interface ReflectorPromptInput {
  plan: Plan;
  step: Step;
  result: StepResult;
  replansLeft: number;
  toolsMarkdown: string;
  notes: string[];
}

export function reflectorSystemPrompt(input: ReflectorPromptInput): string {
  return `You are the Reflector of an autonomous agent. After each step finishes you decide how the plan proceeds.

Decide exactly one action:
- "continue": the plan is still adequate. This is the default when the step succeeded and later steps still make sense.
- "replan": the plan must change. Provide a minimal patch: "add" new steps, "update" a pending/failed step (goal, tools, dependsOn, acceptance) or "remove" pending steps. Updating a failed step re-runs it. You cannot modify running or succeeded steps. Only use tools from the available list. Replans left: ${input.replansLeft}${input.replansLeft === 0 ? ' (replan is NOT available now, choose another action)' : ''}.
- "ask_user": only if the task is genuinely ambiguous and no reasonable assumption can be made.
- "finish_early": the objective is already achieved and remaining steps add no value.

If a step failed and a different approach could work, prefer "replan" over giving up. Keep patches small. Respond with JSON only.

Available tools:
${input.toolsMarkdown}`;
}

export function reflectorUserPrompt(input: ReflectorPromptInput): string {
  const steps = input.plan.steps
    .map((s) => {
      const line = `- [${s.status}] ${s.id}: ${s.title}${s.dependsOn.length ? ` (depends on ${s.dependsOn.join(', ')})` : ''}`;
      const summary = s.result?.summary
        ? `\n    result: ${truncate(s.result.summary, 400)}`
        : s.error
          ? `\n    error: ${truncate(s.error, 300)}`
          : '';
      return line + summary;
    })
    .join('\n');
  const notes = input.notes.length
    ? `\n\nUser clarifications so far:\n${input.notes.map((n) => `- ${n}`).join('\n')}`
    : '';
  return `Objective: ${input.plan.objective}

Plan (revision ${input.plan.revision}):
${steps}

Just finished step "${input.step.id}" with status ${input.result.status}:
${truncate(input.result.summary, 1500)}${notes}`;
}

export function finalizerSystemPrompt(): string {
  return `You are the Finalizer of an autonomous agent. Write the final answer for the user based on the completed plan.

Format (Markdown):
1. Start with the direct answer / conclusion.
2. Then the supporting details (tables or lists when helpful).
3. End with a short "说明" / "Notes" section covering limitations, assumptions and any steps that failed or were skipped.

Be specific and reuse the concrete facts from step results. Do not invent facts that are not in the step results. Respond in the language of the objective.`;
}

export function finalizerUserPrompt(plan: Plan, task: string): string {
  const steps = plan.steps
    .map((s) => {
      const status = s.status;
      const summary = s.result?.summary ?? s.error ?? '(no result)';
      const output =
        s.result?.output !== undefined
          ? `\nOutput: ${truncate(JSON.stringify(s.result.output), 2000)}`
          : '';
      return `### ${s.title} (${s.id}) — ${status}\n${summary}${output}`;
    })
    .join('\n\n');
  return `Task:\n${task}\n\nObjective: ${plan.objective}\n\n## Step results\n${steps}`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
