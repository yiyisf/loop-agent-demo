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
  /** Persists a non-transient event; implementations may batch writes. */
  appendEvent(event: RunEvent): Promise<void>;
  /** Events with `seq > fromSeq`, ordered by seq. Pending batched writes are flushed first. */
  events(runId: string, fromSeq?: number, limit?: number): Promise<RunEvent[]>;
  /** Runs that never reached a terminal status (e.g. interrupted by a restart). */
  listUnfinished(): Promise<Run[]>;
}

export interface Stores {
  readonly kind: 'memory' | 'sqlite';
  threads: ThreadStore;
  runs: RunStore;
  close(): Promise<void>;
}
