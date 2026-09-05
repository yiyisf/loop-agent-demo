import type { Plan } from '@loop-agent/shared';
import { streamText } from 'ai';
import { finalizerSystemPrompt, finalizerUserPrompt } from '../prompts.js';
import { RunAbortedError, type RunContext, throwIfAborted, toUsage } from './context.js';
import { errorMessage } from './executor.js';

/** Streams the final answer, emitting `final.text_delta` events; returns the full text. */
export async function finalize(ctx: RunContext, plan: Plan): Promise<string> {
  throwIfAborted(ctx.signal);
  const result = streamText({
    model: ctx.models.model('finalizer', ctx.run.model),
    system: finalizerSystemPrompt(),
    prompt: finalizerUserPrompt(plan, ctx.run.input),
    abortSignal: ctx.signal,
  });

  let text = '';
  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta':
        text += part.text;
        ctx.emit({ type: 'final.text_delta', delta: part.text });
        break;
      case 'finish':
        ctx.emit({ type: 'usage', usage: toUsage(part.totalUsage) });
        break;
      case 'abort':
        throw new RunAbortedError();
      case 'error':
        throw part.error instanceof Error ? part.error : new Error(errorMessage(part.error));
      default:
        break;
    }
  }
  return text;
}
