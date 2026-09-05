import {
  emptyUsage,
  type Plan,
  type Step,
  type StepResult,
  StepResultSchema,
} from '@loop-agent/shared';
import { hasToolCall, isStepCount, ToolLoopAgent, type ToolSet } from 'ai';
import { executorSystemPrompt } from '../prompts.js';
import { FINISH_STEP_TOOL } from '../tools/builtin/index.js';
import type { ToolRuntime } from '../tools/types.js';
import { RunAbortedError, type RunContext, throwIfAborted, toUsage } from './context.js';
import { askUser } from './hitl.js';

export interface ExecuteStepOptions {
  attemptNote?: string;
  /** Hook to wrap tools (approval etc.). */
  wrapTools?: (tools: ToolSet, rt: ToolRuntime) => ToolSet;
}

/**
 * Runs a single step with a dedicated ToolLoopAgent and returns its structured
 * result. Emits step/tool/usage events along the way.
 */
export async function executeStep(
  ctx: RunContext,
  plan: Plan,
  step: Step,
  options: ExecuteStepOptions = {},
): Promise<StepResult> {
  throwIfAborted(ctx.signal);
  const maxToolCalls = ctx.budget.maxToolCallsPerStep;

  const rt: ToolRuntime = {
    runId: ctx.run.id,
    stepId: step.id,
    workspaceDir: ctx.workspaceDir,
    artifacts: ctx.artifacts,
    signal: ctx.signal,
    config: ctx.config,
    logger: ctx.logger,
    askUser: (question, options) => askUser(ctx, step.id, question, options),
  };

  let tools = ctx.tools.pick([...step.tools, FINISH_STEP_TOOL], rt);
  if (options.wrapTools) tools = options.wrapTools(tools, rt);

  const upstream = step.dependsOn
    .map((id) => plan.steps.find((s) => s.id === id))
    .filter((s): s is Step => !!s && !!s.result)
    .map((s) => ({ step: s, summary: s.result!.summary, artifacts: s.result!.artifacts }));

  const agent = new ToolLoopAgent({
    model: ctx.models.model('executor', ctx.run.model),
    instructions: executorSystemPrompt({
      objective: plan.objective,
      step,
      upstream,
      maxToolCalls,
      attemptNote: options.attemptNote,
      notes: ctx.notes,
    }),
    tools,
    // One extra model call is allowed so the forced finish_step can happen.
    stopWhen: [isStepCount(maxToolCalls + 1), hasToolCall(FINISH_STEP_TOOL)],
    prepareStep: ({ stepNumber }) =>
      stepNumber >= maxToolCalls
        ? { toolChoice: { type: 'tool', toolName: FINISH_STEP_TOOL } }
        : undefined,
  });

  const stream = await agent.stream({
    prompt: `Begin step "${step.title}" now.`,
    abortSignal: ctx.signal,
  });

  const toolStarts = new Map<string, number>();
  let finishResult: StepResult | undefined;
  let lastText = '';
  let toolCallCount = 0;

  for await (const part of stream.fullStream) {
    switch (part.type) {
      case 'text-delta':
        lastText += part.text;
        ctx.emit({ type: 'step.text_delta', stepId: step.id, delta: part.text });
        break;
      case 'reasoning-delta':
        ctx.emit({ type: 'step.reasoning_delta', stepId: step.id, delta: part.text });
        break;
      case 'tool-call': {
        if (part.toolName === FINISH_STEP_TOOL) {
          const parsed = StepResultSchema.safeParse(part.input);
          if (parsed.success) finishResult = parsed.data;
          else {
            ctx.emit({
              type: 'log',
              level: 'warn',
              message: `finish_step input invalid: ${parsed.error.message}`,
            });
          }
          break;
        }
        toolStarts.set(part.toolCallId, Date.now());
        toolCallCount += 1;
        ctx.emit({
          type: 'tool.call',
          stepId: step.id,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        });
        break;
      }
      case 'tool-result': {
        if (part.toolName === FINISH_STEP_TOOL) break;
        ctx.emit({
          type: 'tool.result',
          stepId: step.id,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: part.output,
          isError: false,
          durationMs: Date.now() - (toolStarts.get(part.toolCallId) ?? Date.now()),
        });
        ctx.emit({ type: 'usage', usage: { ...emptyUsage(), toolCalls: 1 } });
        break;
      }
      case 'tool-error': {
        ctx.emit({
          type: 'tool.result',
          stepId: step.id,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: { error: errorMessage(part.error) },
          isError: true,
          durationMs: Date.now() - (toolStarts.get(part.toolCallId) ?? Date.now()),
        });
        ctx.emit({ type: 'usage', usage: { ...emptyUsage(), toolCalls: 1 } });
        break;
      }
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

  if (finishResult) return finishResult;

  const text = lastText.trim();
  if (text) {
    // Lenient fallback: the model answered in prose instead of calling finish_step.
    ctx.emit({
      type: 'log',
      level: 'warn',
      message: `Step "${step.id}" ended without finish_step; using final text as summary.`,
    });
    return { status: 'succeeded', summary: text.slice(0, 4000), artifacts: [] };
  }

  return {
    status: 'failed',
    summary: `Step ended after ${toolCallCount} tool call(s) without reporting a result.`,
    artifacts: [],
  };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
