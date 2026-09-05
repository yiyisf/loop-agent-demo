import type { Run, RunEvent, Thread } from '@loop-agent/shared';
import type { RunSnapshot } from '../runtime/projections.js';
import type { LoopAgentUIMessage } from '../runtime/ui-stream.js';

export interface ThreadStore {
  create(title?: string): Promise<Thread>;
  list(): Promise<Thread[]>;
  get(id: string): Promise<Thread | undefined>;
  delete(id: string): Promise<boolean>;
  updateTitle(id: string, title: string): Promise<void>;
  touch(id: string): Promise<void>;
  appendMessage(threadId: string, message: LoopAgentUIMessage): Promise<void>;
  messages(threadId: string): Promise<LoopAgentUIMessage[]>;
}

export interface RunStore {
  create(run: Run): Promise<void>;
  get(runId: string): Promise<Run | undefined>;
  listByThread(threadId: string): Promise<Run[]>;
  saveSnapshot(snapshot: RunSnapshot): Promise<void>;
  getSnapshot(runId: string): Promise<RunSnapshot | undefined>;
  appendEvent(event: RunEvent): Promise<void>;
  events(runId: string, fromSeq?: number, limit?: number): Promise<RunEvent[]>;
  /** Marks runs that were still in-flight when the server stopped. */
  failInterrupted(reason: string): Promise<number>;
}

export interface Stores {
  threads: ThreadStore;
  runs: RunStore;
  close?: () => Promise<void>;
}
