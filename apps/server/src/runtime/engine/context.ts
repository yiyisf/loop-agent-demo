import type { Budget, Run, RunEvent, RunEventPayload, Usage } from '@loop-agent/shared';
import type { LanguageModelUsage } from 'ai';
import type { AppConfig } from '../../config.js';
import type { Logger } from '../../lib/logger.js';
import type { ModelProvider } from '../../providers/model-provider.js';
import type { ArtifactStore } from '../artifacts.js';
import type { RunState } from '../projections.js';
import type { ToolRegistry } from '../tools/registry.js';

export interface RunContext {
  run: Run;
  state: RunState;
  budget: Budget;
  config: AppConfig;
  logger: Logger;
  models: ModelProvider;
  tools: ToolRegistry;
  artifacts: ArtifactStore;
  workspaceDir: string;
  signal: AbortSignal;
  /** Optional conversation context (earlier turns) for the planner. */
  history?: string;
  emit(payload: RunEventPayload): RunEvent;
  /** Resolves when an external party (user) provides the value for `key`. */
  waitFor<T>(key: string): Promise<T>;
  /** Marks the run as auto-approving high-risk tools. */
  autoApprove: boolean;
}

export function toUsage(u: LanguageModelUsage | undefined, extra: Partial<Usage> = {}): Usage {
  const input = u?.inputTokens ?? 0;
  const output = u?.outputTokens ?? 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: u?.totalTokens ?? input + output,
    llmCalls: extra.llmCalls ?? 1,
    toolCalls: extra.toolCalls ?? 0,
  };
}

export class RunAbortedError extends Error {
  constructor(message = 'Run was cancelled') {
    super(message);
    this.name = 'RunAbortedError';
  }
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export class PlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanningError';
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new RunAbortedError();
}
