import type { Plan } from '@loop-agent/shared';
import { streamText } from 'ai';
import { finalizerSystemPrompt, finalizerUserPrompt } from '../prompts.js';
import { RunAbortedError, type RunContext, throwIfAborted, toUsage } from './context.js';
import { errorMessage } from './executor.js';
import { telemetryFor } from './telemetry.js';

/** Streams the final answer, emitting `final.text_delta` events; returns the full text. */
/**
 * Streams the final answer. `interruption` explains why the plan stopped early
 * (e.g. budget exhaustion) so the answer can be framed as a best-effort summary.
 */
export async function finalize(
  ctx: RunContext,
  plan: Plan,
  interruption?: string,
): Promise<string> {
  throwIfAborted(ctx.signal);
  const result = streamText({
    model: ctx.models.model('finalizer', ctx.run.model),
    system: finalizerSystemPrompt(),
    prompt: finalizerUserPrompt(plan, ctx.run.input, interruption),
    abortSignal: ctx.signal,
    telemetry: telemetryFor(ctx.config, 'finalizer'),
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
