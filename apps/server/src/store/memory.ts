import {
  type Approval,
  type Run,
  type RunEvent,
  TERMINAL_RUN_STATUSES,
  type Thread,
} from '@loop-agent/shared';
import { newId, nowIso } from '../lib/ids.js';
import type { RunSnapshot } from '../runtime/projections.js';
import type { LoopAgentUIMessage } from '../runtime/ui-stream.js';
import { applyApprovalEvent } from './approvals.js';
import type { RunStore, StoredArtifact, Stores, ThreadStore } from './types.js';

export class MemoryThreadStore implements ThreadStore {
  private threads = new Map<string, Thread>();
  private messagesByThread = new Map<string, LoopAgentUIMessage[]>();

  async create(title = '新会话'): Promise<Thread> {
    const now = nowIso();
    const thread: Thread = { id: newId('thr'), title, createdAt: now, updatedAt: now };
    this.threads.set(thread.id, thread);
    this.messagesByThread.set(thread.id, []);
    return { ...thread };
  }

  async list(): Promise<Thread[]> {
    return [...this.threads.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((t) => ({ ...t }));
  }

  async get(id: string): Promise<Thread | undefined> {
    const t = this.threads.get(id);
    return t ? { ...t } : undefined;
  }

  async delete(id: string): Promise<boolean> {
    this.messagesByThread.delete(id);
    return this.threads.delete(id);
  }

  async updateTitle(id: string, title: string): Promise<void> {
    const t = this.threads.get(id);
    if (t) {
      t.title = title;
      t.updatedAt = nowIso();
    }
  }

  async touch(id: string): Promise<void> {
    const t = this.threads.get(id);
    if (t) t.updatedAt = nowIso();
  }

  async appendMessage(threadId: string, message: LoopAgentUIMessage): Promise<void> {
    const list = this.messagesByThread.get(threadId);
    if (!list) throw new Error(`Unknown thread ${threadId}`);
    const idx = list.findIndex((m) => m.id === message.id);
    if (idx >= 0) list[idx] = structuredClone(message);
    else list.push(structuredClone(message));
    await this.touch(threadId);
  }

  async messages(threadId: string): Promise<LoopAgentUIMessage[]> {
    return (this.messagesByThread.get(threadId) ?? []).map((m) => structuredClone(m));
  }
}

export class MemoryRunStore implements RunStore {
  private runs = new Map<string, Run>();
  private snapshots = new Map<string, RunSnapshot>();
  private eventsByRun = new Map<string, RunEvent[]>();
  private approvalsById = new Map<string, Approval>();
  private artifactsById = new Map<string, StoredArtifact>();

  async create(run: Run): Promise<void> {
    this.runs.set(run.id, structuredClone(run));
    this.eventsByRun.set(run.id, []);
  }

  async get(runId: string): Promise<Run | undefined> {
    const snap = this.snapshots.get(runId);
    const run = snap?.run ?? this.runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  async listByThread(threadId: string): Promise<Run[]> {
    const out: Run[] = [];
    for (const id of this.runs.keys()) {
      const r = await this.get(id);
      if (r && r.threadId === threadId) out.push(r);
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async saveSnapshot(snapshot: RunSnapshot): Promise<void> {
    this.snapshots.set(snapshot.run.id, structuredClone(snapshot));
    this.runs.set(snapshot.run.id, structuredClone(snapshot.run));
  }

  async getSnapshot(runId: string): Promise<RunSnapshot | undefined> {
    const s = this.snapshots.get(runId);
    return s ? structuredClone(s) : undefined;
  }

  async appendEvent(event: RunEvent): Promise<void> {
    const list = this.eventsByRun.get(event.runId);
    if (list) list.push(event);
    else this.eventsByRun.set(event.runId, [event]);
    applyApprovalEvent(this.approvalsById, event);
  }

  async approvals(runId: string): Promise<Approval[]> {
    return [...this.approvalsById.values()]
      .filter((a) => a.runId === runId)
      .map((a) => structuredClone(a));
  }

  async listPendingApprovals(): Promise<Approval[]> {
    return [...this.approvalsById.values()]
      .filter((a) => a.status === 'pending')
      .map((a) => structuredClone(a));
  }

  async saveArtifact(artifact: StoredArtifact): Promise<void> {
    this.artifactsById.set(artifact.id, structuredClone(artifact));
  }

  async artifacts(runId: string): Promise<StoredArtifact[]> {
    return [...this.artifactsById.values()]
      .filter((a) => a.runId === runId)
      .map((a) => structuredClone(a));
  }

  async getArtifact(id: string): Promise<StoredArtifact | undefined> {
    const a = this.artifactsById.get(id);
    return a ? structuredClone(a) : undefined;
  }

  async events(runId: string, fromSeq = 0, limit = 1000): Promise<RunEvent[]> {
    return (this.eventsByRun.get(runId) ?? []).filter((e) => e.seq > fromSeq).slice(0, limit);
  }

  async listUnfinished(): Promise<Run[]> {
    const out: Run[] = [];
    for (const id of this.runs.keys()) {
      const run = await this.get(id);
      if (run && !TERMINAL_RUN_STATUSES.has(run.status)) out.push(run);
    }
    return out;
  }
}

export function createMemoryStores(): Stores {
  return {
    kind: 'memory',
    threads: new MemoryThreadStore(),
    runs: new MemoryRunStore(),
    close: async () => undefined,
  };
}
