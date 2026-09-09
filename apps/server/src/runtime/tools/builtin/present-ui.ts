import { UiWidgetSchema } from '@loop-agent/shared';
import { tool } from 'ai';
import { newId } from '../../../lib/ids.js';
import type { ToolDefinition } from '../types.js';

export const PRESENT_UI_TOOL = 'present_ui';

export const presentUiTool: ToolDefinition = {
  name: PRESENT_UI_TOOL,
  description:
    'Show a structured UI card to the user: table, choice, metric, or form. Never emit HTML. Use when the user should pick, compare rows, read key numbers, or fill a short form.',
  risk: 'low',
  category: 'interaction',
  plannable: true,
  create: () =>
    tool({
      description:
        'Present one whitelist UI widget. kind is table | choice | metric | form. The user can click a row/option or submit the form as the next message.',
      inputSchema: UiWidgetSchema,
      execute: async (widget) => {
        const parsed = UiWidgetSchema.safeParse(widget);
        if (!parsed.success) {
          return {
            error: `Invalid UI widget: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          };
        }
        return { id: newId('ui'), widget: parsed.data };
      },
    }),
};
