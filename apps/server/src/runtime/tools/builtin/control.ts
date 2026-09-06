import { StepResultSchema } from '@loop-agent/shared';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

export const FINISH_STEP_TOOL = 'finish_step';
export const ASK_USER_TOOL = 'ask_user';

export const finishStepTool: ToolDefinition = {
  name: FINISH_STEP_TOOL,
  description:
    'Finish the current step by reporting its outcome. Call this exactly once when the step is done or cannot be completed.',
  risk: 'low',
  category: 'control',
  plannable: false,
  create: () =>
    tool({
      description:
        'Report the final outcome of the current step. status=succeeded when the acceptance criteria are met, otherwise failed. The summary must contain the concrete findings/results needed by later steps.',
      inputSchema: StepResultSchema,
      execute: async (input) => ({ recorded: true, status: input.status }),
    }),
};

export const askUserTool: ToolDefinition = {
  name: ASK_USER_TOOL,
  description:
    'Ask the user a clarifying question and wait for the answer. Use only when the task cannot proceed without user input.',
  risk: 'low',
  category: 'interaction',
  plannable: true,
  create: (rt) =>
    tool({
      description:
        'Ask the user a question and wait for their answer. Provide short options when a choice is expected.',
      inputSchema: z.object({
        question: z.string().min(1),
        options: z.array(z.string()).max(6).optional(),
      }),
      execute: async ({ question, options }) => {
        if (!rt.askUser) {
          return {
            error:
              'User interaction is not available in this run. Proceed with a reasonable assumption.',
          };
        }
        const answer = await rt.askUser(question, options);
        return { answer };
      },
    }),
};
