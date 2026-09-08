import { z } from 'zod';
import { routerSystemPrompt } from '../prompts.js';
import { generateStructured } from '../structured.js';
import { type RunContext, toUsage } from './context.js';
import { telemetryFor } from './telemetry.js';

export const ExecutionRouteSchema = z.object({
  route: z.enum(['chat', 'workflow']),
  reason: z.string().min(1),
});
export type ExecutionRoute = z.infer<typeof ExecutionRouteSchema>['route'];

const WORKFLOW_SIGNAL =
  /对比|调研|规划|抓取|计算|方案|步骤|分析|整理|迁移|路线|模板|周报|实现|编写|帮我|任务|workflow|compare|research|plan|migrate|implement|write a/i;

/** Conservative default: keep existing auto=workflow behavior unless the turn is clearly small talk. */
export function heuristicRoute(input: string): ExecutionRoute {
  const text = input.trim();
  if (!text) return 'workflow';
  if (WORKFLOW_SIGNAL.test(text)) return 'workflow';
  if (text.length <= 24 && /^(你好|嗨|hi|hello|谢谢|thanks|ok|好的)[！!。.?？\s]*$/i.test(text)) {
    return 'chat';
  }
  if (text.length <= 40 && /[?？]$/.test(text) && !WORKFLOW_SIGNAL.test(text)) return 'chat';
  return 'workflow';
}

const ROUTE_CONTRACT = `{"route":"chat"|"workflow","reason":"short why"}`;

export async function resolveExecutionRoute(ctx: RunContext): Promise<ExecutionRoute> {
  if (ctx.run.mode === 'chat') return 'chat';
  if (ctx.run.mode === 'plan_first') return 'workflow';
  if (ctx.models.kind === 'mock') return heuristicRoute(ctx.run.input);

  try {
    const result = await generateStructured({
      model: ctx.models.model('default', ctx.run.model),
      schema: ExecutionRouteSchema,
      system: routerSystemPrompt(),
      prompt: `User message:\n${ctx.run.input}`,
      contract: ROUTE_CONTRACT,
      schemaName: 'ExecutionRoute',
      abortSignal: ctx.signal,
      telemetry: telemetryFor(ctx.config, 'router'),
      attempts: 1,
    });
    ctx.emit({ type: 'usage', usage: toUsage(result.usage) });
    return result.object.route;
  } catch {
    return heuristicRoute(ctx.run.input);
  }
}
