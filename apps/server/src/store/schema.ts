import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const threads = sqliteTable('threads', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const messages = sqliteTable(
  'messages',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull(),
    threadId: text('thread_id').notNull(),
    role: text('role').notNull(),
    parts: text('parts', { mode: 'json' }).notNull(),
    metadata: text('metadata', { mode: 'json' }),
    runId: text('run_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('messages_id_idx').on(t.id), index('messages_thread_idx').on(t.threadId)],
);

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id').notNull(),
    status: text('status').notNull(),
    input: text('input').notNull(),
    mode: text('mode').notNull(),
    model: text('model'),
    currentRevision: integer('current_revision').notNull().default(0),
    budget: text('budget', { mode: 'json' }).notNull(),
    usage: text('usage', { mode: 'json' }).notNull(),
    finalAnswer: text('final_answer'),
    error: text('error'),
    /** Full RunSnapshot JSON, written when the run reaches a terminal state. */
    snapshot: text('snapshot', { mode: 'json' }),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    endedAt: text('ended_at'),
  },
  (t) => [index('runs_thread_idx').on(t.threadId), index('runs_status_idx').on(t.status)],
);

export const planRevisions = sqliteTable(
  'plan_revisions',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    revision: integer('revision').notNull(),
    objective: text('objective').notNull(),
    rationale: text('rationale'),
    steps: text('steps', { mode: 'json' }).notNull(),
    diff: text('diff', { mode: 'json' }),
    reason: text('reason'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('plan_revisions_run_idx').on(t.runId)],
);

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id').notNull(),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    ts: text('ts').notNull(),
  },
  (t) => [uniqueIndex('events_run_seq_idx').on(t.runId, t.seq)],
);

/**
 * Idempotent DDL applied on startup. Kept in code (instead of drizzle-kit
 * migration files) so the server has no runtime dependency on a migrations
 * directory; schema changes must be additive or handled here explicitly.
 */
export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL,
    parts TEXT NOT NULL,
    metadata TEXT,
    run_id TEXT,
    created_at TEXT NOT NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS messages_id_idx ON messages (id)',
  'CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread_id)',
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    status TEXT NOT NULL,
    input TEXT NOT NULL,
    mode TEXT NOT NULL,
    model TEXT,
    current_revision INTEGER NOT NULL DEFAULT 0,
    budget TEXT NOT NULL,
    usage TEXT NOT NULL,
    final_answer TEXT,
    error TEXT,
    snapshot TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS runs_thread_idx ON runs (thread_id)',
  'CREATE INDEX IF NOT EXISTS runs_status_idx ON runs (status)',
  `CREATE TABLE IF NOT EXISTS plan_revisions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    objective TEXT NOT NULL,
    rationale TEXT,
    steps TEXT NOT NULL,
    diff TEXT,
    reason TEXT,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS plan_revisions_run_idx ON plan_revisions (run_id)',
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    ts TEXT NOT NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS events_run_seq_idx ON events (run_id, seq)',
];
