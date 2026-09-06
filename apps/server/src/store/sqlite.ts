import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { type Client, createClient } from '@libsql/client';
import {
  type Approval,
  type Budget,
  type Run,
  type RunEvent,
  type RunSnapshot,
  TERMINAL_RUN_STATUSES,
  type Thread,
  type Usage,
} from '@loop-agent/shared';
import { and, asc, desc, eq, gt, inArray, notInArray } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { newId, nowIso } from '../lib/ids.js';
import type { LoopAgentUIMessage } from '../runtime/ui-stream.js';
import { applyApprovalEvent } from './approvals.js';
import * as schema from './schema.js';
import type { RunStore, StoredArtifact, Stores, ThreadStore } from './types.js';

type Db = LibSQLDatabase<typeof schema>;

export interface SqliteStoreOptions {
  url: string;
  /** Flush pending events after this many milliseconds (default 50). */
  flushIntervalMs?: number;
  /** Flush immediately once this many events are pending (default 20). */
  flushBatchSize?: number;
}

export class SqliteThreadStore implements ThreadStore {
  constructor(
    private readonly db: Db,
    private readonly flushEvents: () => Promise<void>,
  ) {}

  async create(title = '新会话'): Promise<Thread> {
    const now = nowIso();
    const thread: Thread = { id: newId('thr'), title, createdAt: now, updatedAt: now };
    await this.db.insert(schema.threads).values(thread);
    return thread;
  }

  async list(): Promise<Thread[]> {
    return this.db.select().from(schema.threads).orderBy(desc(schema.threads.updatedAt));
  }

  async get(id: string): Promise<Thread | undefined> {
    const rows = await this.db.select().from(schema.threads).where(eq(schema.threads.id, id));
    return rows[0];
  }

  async delete(id: string): Promise<boolean> {
    // Ensure no batched event lands after the run rows are gone.
    await this.flushEvents();
    const existing = await this.get(id);
    if (!existing) return false;
    const runIds = (
      await this.db
        .select({ id: schema.runs.id })
        .from(schema.runs)
        .where(eq(schema.runs.threadId, id))
    ).map((r) => r.id);
    await this.db.transaction(async (tx) => {
      if (runIds.length > 0) {
        await tx.delete(schema.events).where(inArray(schema.events.runId, runIds));
        await tx.delete(schema.planRevisions).where(inArray(schema.planRevisions.runId, runIds));
        await tx.delete(schema.approvals).where(inArray(schema.approvals.runId, runIds));
        await tx.delete(schema.artifacts).where(inArray(schema.artifacts.runId, runIds));
        await tx.delete(schema.runs).where(inArray(schema.runs.id, runIds));
      }
      await tx.delete(schema.messages).where(eq(schema.messages.threadId, id));
      await tx.delete(schema.threads).where(eq(schema.threads.id, id));
    });
    return true;
  }

  async updateTitle(id: string, title: string): Promise<void> {
    await this.db
      .update(schema.threads)
      .set({ title, updatedAt: nowIso() })
      .where(eq(schema.threads.id, id));
  }

  async touch(id: string): Promise<void> {
    await this.db
      .update(schema.threads)
      .set({ updatedAt: nowIso() })
      .where(eq(schema.threads.id, id));
  }

  async appendMessage(threadId: string, message: LoopAgentUIMessage): Promise<void> {
    const thread = await this.get(threadId);
    if (!thread) throw new Error(`Unknown thread ${threadId}`);
    const row = {
      id: message.id,
      threadId,
      role: message.role,
      parts: message.parts,
      metadata: message.metadata ?? null,
      runId: message.metadata?.runId ?? null,
      createdAt: message.metadata?.createdAt ?? nowIso(),
    };
    await this.db
      .insert(schema.messages)
      .values(row)
      .onConflictDoUpdate({
        target: schema.messages.id,
        set: { parts: row.parts, metadata: row.metadata, runId: row.runId },
      });
    await this.touch(threadId);
  }

  async messages(threadId: string): Promise<LoopAgentUIMessage[]> {
    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.threadId, threadId))
      .orderBy(asc(schema.messages.seq));
    return rows.map((r) => ({
      id: r.id,
      role: r.role as LoopAgentUIMessage['role'],
      parts: r.parts as LoopAgentUIMessage['parts'],
      metadata: (r.metadata ?? undefined) as LoopAgentUIMessage['metadata'],
    }));
  }
}

const TERMINAL = [...TERMINAL_RUN_STATUSES];

export class SqliteRunStore implements RunStore {
  private pending: RunEvent[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private flushing: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly db: Db,
    private readonly options: Required<
      Pick<SqliteStoreOptions, 'flushIntervalMs' | 'flushBatchSize'>
    >,
  ) {}

  async create(run: Run): Promise<void> {
    await this.db
      .insert(schema.runs)
      .values(runToRow(run))
      .onConflictDoNothing({ target: schema.runs.id });
  }

  async get(runId: string): Promise<Run | undefined> {
    const rows = await this.db.select().from(schema.runs).where(eq(schema.runs.id, runId));
    return rows[0] ? rowToRun(rows[0]) : undefined;
  }

  async listByThread(threadId: string): Promise<Run[]> {
    const rows = await this.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.threadId, threadId))
      .orderBy(asc(schema.runs.createdAt));
    return rows.map(rowToRun);
  }

  async saveSnapshot(snapshot: RunSnapshot): Promise<void> {
    await this.flush();
    const row = { ...runToRow(snapshot.run), snapshot };
    await this.db
      .insert(schema.runs)
      .values(row)
      .onConflictDoUpdate({ target: schema.runs.id, set: row });
  }

  async getSnapshot(runId: string): Promise<RunSnapshot | undefined> {
    const rows = await this.db
      .select({ snapshot: schema.runs.snapshot })
      .from(schema.runs)
      .where(eq(schema.runs.id, runId));
    return (rows[0]?.snapshot ?? undefined) as RunSnapshot | undefined;
  }

  async appendEvent(event: RunEvent): Promise<void> {
    if (this.closed) return;
    this.pending.push(event);
    if (this.pending.length >= this.options.flushBatchSize) {
      await this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), this.options.flushIntervalMs);
      this.flushTimer.unref?.();
    }
  }

  /** Writes all pending events; serialized so batches never interleave. */
  flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.pending.length === 0) return this.flushing;
    const batch = this.pending;
    this.pending = [];
    this.flushing = this.flushing.then(() => this.writeBatch(batch)).catch(() => undefined);
    return this.flushing;
  }

  private async writeBatch(batch: RunEvent[]): Promise<void> {
    const revisions = batch
      .filter((e) => e.type === 'plan.created' || e.type === 'plan.revised')
      .map((e) => {
        if (e.type !== 'plan.created' && e.type !== 'plan.revised') throw new Error('unreachable');
        return {
          id: `${e.runId}:${e.plan.revision}`,
          runId: e.runId,
          revision: e.plan.revision,
          objective: e.plan.objective,
          rationale: e.plan.rationale ?? null,
          steps: e.plan.steps,
          diff: e.type === 'plan.revised' ? e.diff : null,
          reason: e.type === 'plan.revised' ? e.reason : null,
          createdAt: e.ts,
        };
      });
    // Approval rows: requests in this batch are inserted whole; resolutions of
    // earlier requests become updates.
    const requested = new Map<string, Approval>();
    const resolutions: Extract<RunEvent, { type: 'approval.resolved' }>[] = [];
    for (const e of batch) {
      if (e.type === 'approval.requested') applyApprovalEvent(requested, e);
      else if (e.type === 'approval.resolved') {
        if (requested.has(e.approvalId)) applyApprovalEvent(requested, e);
        else resolutions.push(e);
      }
    }

    await this.db.transaction(async (tx) => {
      await tx
        .insert(schema.events)
        .values(
          batch.map((e) => {
            const { runId, seq, ts, type, ...payload } = e;
            return { runId, seq, ts, type, payload };
          }),
        )
        .onConflictDoNothing();
      if (revisions.length > 0) {
        await tx.insert(schema.planRevisions).values(revisions).onConflictDoNothing();
      }
      if (requested.size > 0) {
        await tx
          .insert(schema.approvals)
          .values([...requested.values()].map(approvalToRow))
          .onConflictDoNothing();
      }
      for (const r of resolutions) {
        await tx
          .update(schema.approvals)
          .set({
            status: r.approved ? 'approved' : 'denied',
            resolution: r.reason ?? null,
            resolvedAt: r.ts,
          })
          .where(eq(schema.approvals.id, r.approvalId));
      }
    });
  }

  async approvals(runId: string): Promise<Approval[]> {
    await this.flush();
    const rows = await this.db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.runId, runId))
      .orderBy(asc(schema.approvals.createdAt));
    return rows.map(rowToApproval);
  }

  async listPendingApprovals(): Promise<Approval[]> {
    await this.flush();
    const rows = await this.db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.status, 'pending'))
      .orderBy(asc(schema.approvals.createdAt));
    return rows.map(rowToApproval);
  }

  async saveArtifact(artifact: StoredArtifact): Promise<void> {
    await this.db
      .insert(schema.artifacts)
      .values(artifact)
      .onConflictDoUpdate({ target: schema.artifacts.id, set: artifact });
  }

  async artifacts(runId: string): Promise<StoredArtifact[]> {
    return this.db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.runId, runId))
      .orderBy(asc(schema.artifacts.createdAt));
  }

  async getArtifact(id: string): Promise<StoredArtifact | undefined> {
    const rows = await this.db.select().from(schema.artifacts).where(eq(schema.artifacts.id, id));
    return rows[0];
  }

  async events(runId: string, fromSeq = 0, limit = 1000): Promise<RunEvent[]> {
    await this.flush();
    const rows = await this.db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.runId, runId), gt(schema.events.seq, fromSeq)))
      .orderBy(asc(schema.events.seq))
      .limit(limit);
    return rows.map(
      (r) =>
        ({
          ...(r.payload as Record<string, unknown>),
          type: r.type,
          runId: r.runId,
          seq: r.seq,
          ts: r.ts,
        }) as RunEvent,
    );
  }

  async listUnfinished(): Promise<Run[]> {
    const rows = await this.db
      .select()
      .from(schema.runs)
      .where(notInArray(schema.runs.status, TERMINAL));
    return rows.map(rowToRun);
  }

  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
  }
}

type RunRow = typeof schema.runs.$inferSelect;
type ApprovalRow = typeof schema.approvals.$inferSelect;

function approvalToRow(a: Approval): ApprovalRow {
  return {
    id: a.id,
    runId: a.runId,
    stepId: a.stepId,
    toolCallId: a.toolCallId,
    toolName: a.toolName,
    input: a.input ?? null,
    reason: a.reason ?? null,
    status: a.status,
    resolution: a.resolution ?? null,
    createdAt: a.createdAt,
    resolvedAt: a.resolvedAt ?? null,
  };
}

function rowToApproval(r: ApprovalRow): Approval {
  return {
    id: r.id,
    runId: r.runId,
    stepId: r.stepId,
    toolCallId: r.toolCallId,
    toolName: r.toolName,
    input: r.input ?? undefined,
    reason: r.reason ?? undefined,
    status: r.status as Approval['status'],
    resolution: r.resolution ?? undefined,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt ?? undefined,
  };
}

function runToRow(run: Run): Omit<RunRow, 'snapshot'> {
  return {
    id: run.id,
    threadId: run.threadId,
    status: run.status,
    input: run.input,
    mode: run.mode,
    model: run.model ?? null,
    currentRevision: run.currentRevision,
    budget: run.budget,
    usage: run.usage,
    finalAnswer: run.finalAnswer ?? null,
    error: run.error ?? null,
    createdAt: run.createdAt,
    startedAt: run.startedAt ?? null,
    endedAt: run.endedAt ?? null,
  };
}

function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    threadId: row.threadId,
    status: row.status as Run['status'],
    input: row.input,
    mode: row.mode as Run['mode'],
    model: row.model ?? undefined,
    currentRevision: row.currentRevision,
    budget: row.budget as Budget,
    usage: row.usage as Usage,
    finalAnswer: row.finalAnswer ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? undefined,
    endedAt: row.endedAt ?? undefined,
  };
}

async function ensureDirectory(url: string): Promise<void> {
  if (!url.startsWith('file:')) return;
  const file = url.slice('file:'.length);
  if (file === ':memory:' || file.startsWith(':memory:')) return;
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
}

export async function createSqliteStores(options: SqliteStoreOptions): Promise<Stores> {
  await ensureDirectory(options.url);
  const client: Client = createClient({ url: options.url });
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA busy_timeout = 5000');
  for (const statement of schema.MIGRATIONS) await client.execute(statement);

  const db = drizzle(client, { schema });
  const runs = new SqliteRunStore(db, {
    flushIntervalMs: options.flushIntervalMs ?? 50,
    flushBatchSize: options.flushBatchSize ?? 20,
  });
  const threads = new SqliteThreadStore(db, () => runs.flush());

  return {
    kind: 'sqlite',
    threads,
    runs,
    close: async () => {
      await runs.close();
      client.close();
    },
  };
}
