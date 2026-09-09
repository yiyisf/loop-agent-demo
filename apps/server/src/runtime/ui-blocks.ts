import { type UiBlock, UiBlockSchema } from '@loop-agent/shared';
import type { RunContext } from './engine/context.js';
import { PRESENT_UI_TOOL } from './tools/builtin/present-ui.js';

export function uiBlockFromTool(toolName: string, output: unknown): UiBlock | undefined {
  if (toolName !== PRESENT_UI_TOOL) return undefined;
  const parsed = UiBlockSchema.safeParse(output);
  return parsed.success ? parsed.data : undefined;
}

export function emitToolUi(ctx: RunContext, toolName: string, output: unknown): void {
  const block = uiBlockFromTool(toolName, output);
  if (block) ctx.emit({ type: 'ui.presented', block });
}
