import type { Tool } from 'ai';
import type { AppConfig } from '../../config.js';
import type { Logger } from '../../lib/logger.js';
import type { ArtifactStore } from '../artifacts.js';

export type ToolRisk = 'low' | 'medium' | 'high';
export type ToolCategory = 'search' | 'fetch' | 'compute' | 'fs' | 'interaction' | 'control';

/** Per-step runtime handed to tool factories. */
export interface ToolRuntime {
  runId: string;
  stepId: string;
  workspaceDir: string;
  artifacts: ArtifactStore;
  signal: AbortSignal;
  config: AppConfig;
  logger: Logger;
  /** Ask the user a question and wait for the answer (wired in HITL phase). */
  askUser?: (question: string, options?: string[]) => Promise<string>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  risk: ToolRisk;
  category: ToolCategory;
  /** Whether the tool should be offered to the planner (control tools are not). */
  plannable: boolean;
  /** Returns a reason string when the tool is unavailable in this deployment. */
  disabledReason?: (config: AppConfig) => string | undefined;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous tool set
  create: (rt: ToolRuntime) => Tool<any, any>;
}

export interface ToolInfo {
  name: string;
  description: string;
  risk: ToolRisk;
  category: ToolCategory;
  enabled: boolean;
  disabledReason?: string;
}
