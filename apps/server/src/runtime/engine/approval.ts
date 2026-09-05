import type { ApprovalResponse, RunStatus } from '@loop-agent/shared';
import type { Tool, ToolSet } from 'ai';
import { newId } from '../../lib/ids.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolRisk, ToolRuntime } from '../tools/types.js';
import type { RunContext } from './context.js';
import { waitKeys } from './hitl.js';

const RISK_LABEL: Record<ToolRisk, string> = { low: '低', medium: '中', high: '高' };

/** Tools above `low` risk pause for a human decision unless the run auto-approves. */
export function requiresApproval(risk: ToolRisk, ctx: Pick<RunContext, 'autoApprove'>): boolean {
  return risk !== 'low' && !ctx.autoApprove;
}

/**
 * Wraps each tool that needs approval so its execution blocks until the user
 * decides. A denial is returned to the model as a regular tool output so it can
 * adapt (or report the step as failed) instead of crashing the step.
 */
export function withApproval(
  tools: ToolSet,
  rt: ToolRuntime,
  ctx: RunContext,
  registry: ToolRegistry,
): ToolSet {
  const wrapped: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    const def = registry.get(name);
    if (!def || !tool.execute || !requiresApproval(def.risk, ctx)) {
      wrapped[name] = tool;
      continue;
    }
    const original = tool.execute;
    wrapped[name] = {
      ...tool,
      execute: async (input, options) => {
        const approvalId = newId('apr');
        const step = ctx.state.step(rt.stepId);
        const previous: RunStatus = ctx.state.run.status;
        ctx.emit({
          type: 'approval.requested',
          approvalId,
          stepId: rt.stepId,
          toolCallId: options.toolCallId,
          toolName: name,
          input,
          reason: `${name} 属于${RISK_LABEL[def.risk]}风险工具，需要你的确认`,
        });
        ctx.emit({ type: 'run.status', status: 'awaiting_approval' });
        if (step) {
          ctx.emit({
            type: 'step.status',
            stepId: rt.stepId,
            status: 'waiting_approval',
            attempt: step.attempt,
          });
        }

        let decision: ApprovalResponse;
        try {
          decision = await ctx.waitFor<ApprovalResponse>(waitKeys.approval(approvalId));
        } finally {
          if (!ctx.signal.aborted) {
            if (step) {
              ctx.emit({
                type: 'step.status',
                stepId: rt.stepId,
                status: 'running',
                attempt: step.attempt,
              });
            }
            ctx.emit({
              type: 'run.status',
              status: previous === 'awaiting_approval' ? 'executing' : previous,
            });
          }
        }

        ctx.emit({
          type: 'approval.resolved',
          approvalId,
          approved: decision.approved,
          reason: decision.reason,
        });
        if (!decision.approved) {
          ctx.notes.push(
            `User denied tool ${name} (${JSON.stringify(input).slice(0, 200)})${
              decision.reason ? `: ${decision.reason}` : ''
            }`,
          );
          return {
            error: `The user denied this ${name} call${decision.reason ? `: ${decision.reason}` : ''}. Do not retry the same call; adapt your approach or finish the step with status "failed".`,
            denied: true,
          };
        }
        return original(input, options);
      },
    } as Tool;
  }
  return wrapped;
}
