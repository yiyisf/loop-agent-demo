import { emptyUsage } from '@loop-agent/shared';
import { isStepCount, ToolLoopAgent } from 'ai';
import { formatAttachmentsPrompt } from '../attachments.js';
import { emitToolCitations } from '../citations.js';
import { chatSystemPrompt } from '../prompts.js';
import { FINISH_STEP_TOOL } from '../tools/builtin/index.js';
import type { ToolRuntime } from '../tools/types.js';
import { withApproval } from './approval.js';
import { RunAbortedError, type RunContext, throwIfAborted, toUsage } from './context.js';
import { errorMessage } from './executor.js';
import { askUser } from './hitl.js';
import { telemetryFor } from './telemetry.js';

/** Synthetic step id so tool / approval / question events stay on one run. */
export const CHAT_STEP_ID = 'chat';

export async function runChatTurn(ctx: RunContext): Promise<void> {
  throwIfAborted(ctx.signal);
  ctx.emit({ type: 'run.status', status: 'executing' });

  const names = ctx.tools
    .list()
    .filter((t) => t.enabled && t.name !== FINISH_STEP_TOOL)
    .map((t) => t.name);

  const rt: ToolRuntime = {
    runId: ctx.run.id,
    stepId: CHAT_STEP_ID,
    workspaceDir: ctx.workspaceDir,
    artifacts: ctx.artifacts,
    signal: ctx.signal,
    config: ctx.config,
    logger: ctx.logger,
    askUser: (question, options) => askUser(ctx, CHAT_STEP_ID, question, options),
  };
  const tools = withApproval(ctx.tools.pick(names, rt), rt, ctx, ctx.tools);
  const maxToolCalls = ctx.budget.maxToolCallsPerStep;

  const agent = new ToolLoopAgent({
    model: ctx.models.model('chat', ctx.run.model),
    instructions: chatSystemPrompt(
      ctx.tools.describeForPlanner(),
      ctx.history,
      formatAttachmentsPrompt(ctx.attachments),
    ),
    tools,
    stopWhen: [isStepCount(maxToolCalls)],
    telemetry: telemetryFor(ctx.config, 'chat'),
  });

  const stream = await agent.stream({
    prompt: ctx.run.input,
    abortSignal: ctx.signal,
  });

  const toolStarts = new Map<string, number>();
  let answer = '';

  for await (const part of stream.fullStream) {
    switch (part.type) {
      case 'text-delta':
        answer += part.text;
        ctx.emit({ type: 'final.text_delta', delta: part.text });
        break;
      case 'reasoning-delta':
        ctx.emit({ type: 'step.reasoning_delta', stepId: CHAT_STEP_ID, delta: part.text });
        break;
      case 'tool-call':
        toolStarts.set(part.toolCallId, Date.now());
        ctx.emit({
          type: 'tool.call',
          stepId: CHAT_STEP_ID,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        });
        break;
      case 'tool-result':
        ctx.emit({
          type: 'tool.result',
          stepId: CHAT_STEP_ID,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: part.output,
          isError: false,
          durationMs: Date.now() - (toolStarts.get(part.toolCallId) ?? Date.now()),
        });
        ctx.emit({ type: 'usage', usage: { ...emptyUsage(), toolCalls: 1 } });
        emitToolCitations(ctx, part.toolName, part.output);
        break;
      case 'tool-error':
        ctx.emit({
          type: 'tool.result',
          stepId: CHAT_STEP_ID,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: { error: errorMessage(part.error) },
          isError: true,
          durationMs: Date.now() - (toolStarts.get(part.toolCallId) ?? Date.now()),
        });
        ctx.emit({ type: 'usage', usage: { ...emptyUsage(), toolCalls: 1 } });
        break;
      case 'finish-step':
        ctx.emit({ type: 'usage', usage: toUsage(part.usage) });
        break;
      case 'abort':
        throw new RunAbortedError();
      case 'error':
        throw part.error instanceof Error ? part.error : new Error(errorMessage(part.error));
      default:
        break;
    }
  }

  const text = answer.trim();
  ctx.emit({ type: 'final.done', answer: text });
  ctx.emit({
    type: 'run.status',
    status: text ? 'succeeded' : 'failed',
    reason: text ? undefined : 'Model returned an empty reply',
  });
}
