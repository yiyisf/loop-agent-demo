import type { AppConfig } from '../../../config.js';
import { ToolRegistry } from '../registry.js';
import { calculatorTool } from './calculator.js';
import { askUserTool, finishStepTool } from './control.js';
import { httpFetchTool } from './http-fetch.js';
import { webSearchTool } from './web-search.js';
import {
  readArtifactTool,
  workspaceListTool,
  workspaceReadTool,
  workspaceWriteTool,
} from './workspace.js';

export { ASK_USER_TOOL, FINISH_STEP_TOOL } from './control.js';

export function createDefaultToolRegistry(config: AppConfig): ToolRegistry {
  return new ToolRegistry(config)
    .register(webSearchTool)
    .register(httpFetchTool)
    .register(calculatorTool)
    .register(workspaceWriteTool)
    .register(workspaceReadTool)
    .register(workspaceListTool)
    .register(readArtifactTool)
    .register(askUserTool)
    .register(finishStepTool);
}
