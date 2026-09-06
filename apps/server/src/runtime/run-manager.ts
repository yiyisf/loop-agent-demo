import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  type Budget,
  defaultBudget,
  emptyUsage,
  type Run,
  type RunEventPayload,
  type RunMode,
  TERMINAL_RUN_STATUSES,
} from '@loop-agent/shared';
import type { AppConfig } from '../config.js';
import { newId, nowIso } from '../lib/ids.js';
import type { Logger } from '../lib/logger.js';
import type { ModelProvider } from '../providers/model-provider.js';
import { type ArtifactPersistence, ArtifactStore } from './artifacts.js';
import type { RunContext } from './engine/context.js';
import { LoopEngine } from './engine/loop-engine.js';
import type { EventBus } from './event-bus.js';
import { type RunSnapshot, RunState } from './projections.js';
import type { ToolRegistry } from './tools/registry.js';

interface Deferred<T = unknown> {
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

interface ActiveRun {
  run: Run;
  state: RunState;
  controller: AbortController;
  waiters: Map<string, Deferred>;
  done: Promise<void>;
  timeout?: NodeJS.Timeout;
}

export interface StartRunInput {
  threadId: string;
  input: string;
  mode?: RunMode;
  model?: string;
  autoApprove?: boolean;
  history?: string;
  budget?: Partial<Budget>;
}

export interface RunManagerDeps {
  config: AppConfig;
  logger: Logger;
  bus: EventBus;
  models: ModelProvider;
  tools: ToolRegistry;
  engine?: LoopEngine;
  /** Persists artifact metadata so files under DATA_DIR stay discoverable after restarts. */
  artifactPersistence?: ArtifactPersistence;
  /** Called once the run record exists, before the engine starts (persist it here). */
  onRunCreated?: (run: Run) => void | Promise<void>;
  /** Called with the final projection when a run reaches a terminal state. */
  onRunFinished?: (snapshot: RunSnapshot) => void | Promise<void>;
}

export class RunManager {
  private active = new Map<string, ActiveRun>();
  /** Finished runs kept for quick snapshot access; `done` also covers the finish hooks. */
  private finished = new Map<string, { state: RunState; done: Promise<void> }>();
  private readonly engine: LoopEngine;

  constructor(private readonly deps: RunManagerDeps) {
    this.engine =
      deps.engine ?? new LoopEngine({ reflectOnSuccess: deps.config.REFLECT_ON_SUCCESS });
  }

  budgetFromConfig(overrides: Partial<Budget> = {}): Budget {
    const c = this.deps.config;
    return {
      ...defaultBudget(),
      maxSteps: c.BUDGET_MAX_STEPS,
      maxReplans: c.BUDGET_MAX_REPLANS,
      maxParallel: c.BUDGET_MAX_PARALLEL,
      maxDurationMs: c.BUDGET_MAX_DURATION_MS,
      maxTotalTokens: c.BUDGET_MAX_TOTAL_TOKENS,
      ...overrides,
    };
  }

  /** Creates the run, opens its event channel and starts the loop in the background. */
  async start(input: StartRunInput): Promise<Run> {
    const budget = this.budgetFromConfig(input.budget);
    const run: Run = {
      id: newId('run'),
      threadId: input.threadId,
      status: 'queued',
      input: input.input,
      mode: input.mode ?? 'auto',
      model: input.model,
      currentRevision: 0,
      budget,
      usage: emptyUsage(),
      createdAt: nowIso(),
    };

    const { bus, config, logger } = this.deps;
    await this.deps.onRunCreated?.(run);
    bus.open(run.id);
    const state = new RunState(run);
    const controller = new AbortController();
    const waiters = new Map<string, Deferred>();

    const workspaceDir = path.resolve(config.DATA_DIR, 'runs', run.id, 'workspace');
    await mkdir(workspaceDir, { recursive: true });
    const artifacts = new ArtifactStore(run.id, path.resolve(config.DATA_DIR, 'runs', run.id), {
      persistence: this.deps.artifactPersistence,
    });

    const emit = (payload: RunEventPayload) => {
      const event = bus.append(run.id, payload);
      state.apply(event);
      return event;
    };

    const ctx: RunContext = {
      run: state.run,
      state,
      budget,
      config,
      logger: logger.child({ runId: run.id }),
      models: this.deps.models,
      tools: this.deps.tools,
      artifacts,
      workspaceDir,
      signal: controller.signal,
      history: input.history,
      autoApprove: input.autoApprove ?? false,
      notes: [],
      emit,
      waitFor: <T>(key: string) =>
        new Promise<T>((resolve, reject) => {
          waiters.set(key, { resolve: resolve as (v: unknown) => void, reject });
          controller.signal.addEventListener(
            'abort',
            () => {
              waiters.delete(key);
              reject(controller.signal.reason ?? new Error('aborted'));
            },
            { once: true },
          );
        }),
    };

    const entry: ActiveRun = {
      run: state.run,
      state,
      controller,
      waiters,
      done: Promise.resolve(),
    };
    entry.timeout = setTimeout(() => {
      controller.abort(
        new Error(`timeout: run exceeded ${Math.round(budget.maxDurationMs / 1000)}s time limit`),
      );
    }, budget.maxDurationMs);
    entry.timeout.unref?.();
    this.active.set(run.id, entry);

    entry.done = this.engine
      .run(ctx)
      .catch((err) => {
        logger.error({ err, runId: run.id }, 'engine crashed');
        if (!TERMINAL_RUN_STATUSES.has(state.run.status)) {
          try {
            emit({ type: 'run.status', status: 'failed', reason: 'Engine crashed' });
          } catch {
            // channel may already be closed
          }
        }
      })
      .finally(async () => {
        clearTimeout(entry.timeout);
        bus.close(run.id);
        this.active.delete(run.id);
        this.finished.set(run.id, { state, done: entry.done });
        try {
          await this.deps.onRunFinished?.(state.snapshot());
        } catch (err) {
          logger.error({ err, runId: run.id }, 'onRunFinished failed');
        }
      });

    return structuredClone(state.run);
  }

  get(runId: string): RunSnapshot | undefined {
    return (this.active.get(runId)?.state ?? this.finished.get(runId)?.state)?.snapshot();
  }

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  activeRunForThread(threadId: string): Run | undefined {
    for (const a of this.active.values()) if (a.run.threadId === threadId) return a.run;
    return undefined;
  }

  cancel(runId: string, reason = 'cancelled by user'): boolean {
    const entry = this.active.get(runId);
    if (!entry) return false;
    entry.controller.abort(new Error(reason));
    return true;
  }

  /** Delivers a value to a run waiting on `key` (approvals, answers, plan confirmation). */
  resolve(runId: string, key: string, value: unknown): boolean {
    const entry = this.active.get(runId);
    const waiter = entry?.waiters.get(key);
    if (!entry || !waiter) return false;
    entry.waiters.delete(key);
    waiter.resolve(value);
    return true;
  }

  hasWaiter(runId: string, key: string): boolean {
    return this.active.get(runId)?.waiters.has(key) ?? false;
  }

  /** Waits for a run and its finish hooks to complete (tests, graceful shutdown). */
  async wait(runId: string): Promise<void> {
    await (this.active.get(runId) ?? this.finished.get(runId))?.done;
  }

  async shutdown(): Promise<void> {
    for (const [id] of this.active) this.cancel(id, 'server shutting down');
    await Promise.all([
      ...[...this.active.values()].map((a) => a.done),
      ...[...this.finished.values()].map((f) => f.done),
    ]);
  }
}
