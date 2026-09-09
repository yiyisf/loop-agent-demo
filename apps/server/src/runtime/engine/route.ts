import { z } from 'zod';
import { routerSystemPrompt } from '../prompts.js';
import { generateStructured } from '../structured.js';
import { type RunContext, toUsage } from './context.js';
import { telemetryFor } from './telemetry.js';

export const ExecutionRouteSchema = z.object({
  route: z.enum(['chat', 'workflow']),
  confirmPlan: z.boolean(),
  reason: z.string().min(1),
});
export type ExecutionDecision = z.infer<typeof ExecutionRouteSchema>;
export type ExecutionRoute = ExecutionDecision['route'];

/** Multi-step collaboration — not every task-like sentence. */
const WORKFLOW_SIGNAL =
  /对比|调研|规划|方案|步骤|迁移|路线|模板|周报|分阶段|选型|抓取|编写|readme|workflow|compare|research|plan|migrate|implement/i;

const CONFIRM_PLAN =
  /先(看|列|出|给)?(我)?(看)?计划|确认后再|等我确认|先确认|plan first|confirm (the )?plan|preview the plan/i;

const FOLLOW_UP = /为什么|为啥|解释|改(成|一下|语气)|失败|第.+步|上一条|刚才|继续说|再说清楚/i;

export function wantsPlanConfirmation(input: string): boolean {
  return CONFIRM_PLAN.test(input.trim());
}

/**
 * Conversation-first: greetings, explanations, one-shot tools stay in chat.
 * Workflow only when the turn clearly needs a DAG, or the user asked to confirm a plan.
 */
export function heuristicRoute(input: string, history?: string): ExecutionDecision {
  const text = input.trim();
  if (!text) {
    return { route: 'chat', confirmPlan: false, reason: 'empty' };
  }

  const confirmPlan = wantsPlanConfirmation(text);
  if (confirmPlan) {
    return { route: 'workflow', confirmPlan: true, reason: 'user asked to review the plan' };
  }

  if (history && FOLLOW_UP.test(text) && text.length <= 80) {
    return { route: 'chat', confirmPlan: false, reason: 'follow-up on earlier turn' };
  }

  if (WORKFLOW_SIGNAL.test(text)) {
    return { route: 'workflow', confirmPlan: false, reason: 'multi-step task' };
  }

  return { route: 'chat', confirmPlan: false, reason: 'conversation default' };
}

const ROUTE_CONTRACT = `{"route":"chat"|"workflow","confirmPlan":false,"reason":"short why"}`;

export async function resolveExecutionRoute(ctx: RunContext): Promise<ExecutionDecision> {
  if (ctx.run.mode === 'chat') {
    return { route: 'chat', confirmPlan: false, reason: 'api mode=chat' };
  }
  if (ctx.run.mode === 'plan_first') {
    return { route: 'workflow', confirmPlan: true, reason: 'api mode=plan_first' };
  }

  const fallback = heuristicRoute(ctx.run.input, ctx.history);
  if (ctx.models.kind === 'mock') return fallback;

  try {
    const result = await generateStructured({
      model: ctx.models.model('default', ctx.run.model),
      schema: ExecutionRouteSchema,
      system: routerSystemPrompt(),
      prompt: `Recent context:\n${ctx.history ?? '(none)'}\n\nUser message:\n${ctx.run.input}`,
      contract: ROUTE_CONTRACT,
      schemaName: 'ExecutionRoute',
      abortSignal: ctx.signal,
      telemetry: telemetryFor(ctx.config, 'router'),
      attempts: 1,
    });
    ctx.emit({ type: 'usage', usage: toUsage(result.usage) });
    const decided = result.object;
    if (wantsPlanConfirmation(ctx.run.input)) {
      return { ...decided, route: 'workflow', confirmPlan: true };
    }
    return decided;
  } catch {
    return fallback;
  }
}
