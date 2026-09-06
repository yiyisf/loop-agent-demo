import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultBudget, emptyUsage, type Run } from '@loop-agent/shared';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { defaultMockScript, type MockScript } from '../providers/mock-model.js';
import { createModelProvider } from '../providers/model-provider.js';
import { SERVER_RESTART_REASON } from '../runtime/recovery.js';
import { createSqliteStores } from './sqlite.js';

const logger = pino({ level: 'silent' });
let dataDir: string | undefined;
afterEach(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

async function boot(dir: string, script: MockScript = defaultMockScript) {
  const config = loadConfig({
    LLM_PROVIDER: 'mock',
    DATA_DIR: dir,
    DATABASE_URL: `file:${path.join(dir, 'test.db')}`,
    LOG_LEVEL: 'silent',
  });
  const modelProvider = createModelProvider(config, { mockScript: script });
  return createApp({ config, logger, modelProvider });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('SQLite persistence', () => {
  it('survives a server restart: threads, messages, snapshots and events are reloaded', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'loop-agent-sqlite-'));

    const first = await boot(dataDir);
    const created = await first.app.request('/api/threads', { method: 'POST', body: '{}' });
    const { thread } = (await created.json()) as { thread: { id: string } };
    const res = await first.app.request(`/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '帮我整理一份 TypeScript 学习路线' }),
    });
    const runId = res.headers.get('x-run-id')!;
    await res.text();
    await first.ctx.runManager.wait(runId);
    await first.close();

    const second = await boot(dataDir);
    const detailRes = await second.app.request(`/api/threads/${thread.id}`);
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      thread: { title: string; activeRunId: string | null };
      messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>;
      runs: Array<{ id: string; status: string }>;
    };
    expect(detail.thread.activeRunId).toBeNull();
    expect(detail.thread.title).toBe('帮我整理一份');
    expect(detail.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    const answer = detail.messages[1]!.parts.find((p) => p.type === 'text');
    expect(answer?.text).toContain('mock 模型');
    expect(detail.runs).toEqual([expect.objectContaining({ id: runId, status: 'succeeded' })]);

    const snap = await second.app.request(`/api/runs/${runId}`);
    const snapshot = (await snap.json()) as { plan: { steps: unknown[] } | null; lastSeq: number };
    expect(snapshot.plan?.steps).toHaveLength(3);
    expect(snapshot.lastSeq).toBeGreaterThan(5);

    const eventsRes = await second.app.request(`/api/runs/${runId}/events`);
    const { events, active } = (await eventsRes.json()) as {
      events: Array<{ seq: number; type: string }>;
      active: boolean;
    };
    expect(active).toBe(false);
    expect(events[0]?.seq).toBe(1);
    // Transient deltas are not persisted, so seqs have gaps but stay strictly increasing.
    expect(events.every((e, i) => i === 0 || e.seq > events[i - 1]!.seq)).toBe(true);
    expect(events.some((e) => e.type === 'final.text_delta')).toBe(false);
    expect(events.at(-1)?.type).toBe('run.status');

    // A finished run that is no longer buffered has nothing to resume.
    const stream = await second.app.request(`/api/runs/${runId}/stream`);
    expect(stream.status).toBe(204);
    await second.close();
  });

  it('persists approvals and artifacts so they can be queried and served after a restart', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'loop-agent-sqlite-'));

    // Executor writes a file (artifact) in the first step and fetches a URL
    // (approval) in the second; everything else follows the default demo.
    const script: MockScript = async (ctx) => {
      if (ctx.role === 'planner') {
        const reply = await defaultMockScript(ctx);
        const plan = reply.json as { steps: Array<{ id: string; tools: string[] }> };
        plan.steps.find((s) => s.id === 'understand')!.tools = ['workspace_write'];
        return reply;
      }
      if (
        ctx.role === 'executor' &&
        ctx.callIndex === 0 &&
        ctx.toolNames.includes('workspace_write')
      ) {
        return {
          toolCalls: [
            { toolName: 'workspace_write', input: { path: 'notes.md', content: '# hello\n' } },
          ],
        };
      }
      return defaultMockScript(ctx);
    };

    const first = await boot(dataDir, script);
    const created = await first.app.request('/api/threads', { method: 'POST', body: '{}' });
    const { thread } = (await created.json()) as { thread: { id: string } };
    const res = await first.app.request(`/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '抓取 https://example.com/ 并总结' }),
    });
    const runId = res.headers.get('x-run-id')!;
    void res.text();

    // Wait for the approval request, then check it is visible in the store as pending.
    let approvalId: string | undefined;
    for (let i = 0; i < 300 && !approvalId; i++) {
      approvalId = first.ctx.runManager.get(runId)?.approvals[0]?.id;
      if (!approvalId) await sleep(20);
    }
    expect(approvalId).toBeTruthy();
    const pending = await first.ctx.stores.runs.listPendingApprovals();
    expect(pending).toEqual([
      expect.objectContaining({ id: approvalId, runId, status: 'pending' }),
    ]);

    await first.app.request(`/api/runs/${runId}/approvals/${approvalId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    });
    await first.ctx.runManager.wait(runId);
    await first.close();

    const second = await boot(dataDir);
    const approvals = await second.ctx.stores.runs.approvals(runId);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      id: approvalId,
      toolName: 'http_fetch',
      status: 'approved',
    });
    expect(approvals[0]!.resolvedAt).toBeTruthy();
    expect(await second.ctx.stores.runs.listPendingApprovals()).toEqual([]);

    const listRes = await second.app.request(`/api/runs/${runId}/artifacts`);
    const { artifacts } = (await listRes.json()) as {
      artifacts: Array<{ id: string; name: string; mime: string; path?: string }>;
    };
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ name: 'notes.md', mime: 'text/markdown' });
    expect(artifacts[0]!.path).toBeUndefined();

    const fileRes = await second.app.request(`/api/runs/${runId}/artifacts/${artifacts[0]!.id}`);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get('content-type')).toContain('text/markdown');
    expect(await fileRes.text()).toBe('# hello\n');

    const wrongRun = await second.app.request(`/api/runs/run_other/artifacts/${artifacts[0]!.id}`);
    expect(wrongRun.status).toBe(404);
    await second.close();
  });

  it('closes out runs interrupted by a restart and records them in the thread history', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'loop-agent-sqlite-'));
    const url = `file:${path.join(dataDir, 'test.db')}`;

    // Simulate a crashed process: a run row plus a partial event log, no terminal status.
    const stores = await createSqliteStores({ url });
    const thread = await stores.threads.create('中断的会话');
    const run: Run = {
      id: 'run_interrupted',
      threadId: thread.id,
      status: 'queued',
      input: '被打断的任务',
      mode: 'auto',
      currentRevision: 0,
      budget: defaultBudget(),
      usage: emptyUsage(),
      createdAt: new Date().toISOString(),
    };
    await stores.runs.create(run);
    await stores.threads.appendMessage(thread.id, {
      id: 'msg_user',
      role: 'user',
      parts: [{ type: 'text', text: run.input }],
      metadata: { threadId: thread.id, createdAt: run.createdAt },
    });
    const ts = run.createdAt;
    await stores.runs.appendEvent({
      type: 'run.status',
      status: 'planning',
      runId: run.id,
      seq: 1,
      ts,
    });
    await stores.runs.appendEvent({
      type: 'plan.created',
      runId: run.id,
      seq: 2,
      ts,
      plan: {
        runId: run.id,
        revision: 1,
        objective: 'demo',
        steps: [
          {
            id: 's1',
            title: 'first',
            goal: 'g',
            dependsOn: [],
            tools: [],
            acceptance: 'a',
            status: 'running',
            attempt: 1,
            revisionIntroduced: 1,
          },
          {
            id: 's2',
            title: 'second',
            goal: 'g',
            dependsOn: ['s1'],
            tools: [],
            acceptance: 'a',
            status: 'pending',
            attempt: 0,
            revisionIntroduced: 1,
          },
        ],
        createdAt: ts,
      },
    });
    await stores.runs.appendEvent({
      type: 'run.status',
      status: 'executing',
      runId: run.id,
      seq: 3,
      ts,
    });
    await stores.close();

    const config = loadConfig({
      LLM_PROVIDER: 'mock',
      DATA_DIR: dataDir,
      DATABASE_URL: url,
      LOG_LEVEL: 'silent',
    });
    const { app, close } = await createApp({ config, logger });

    const runRes = await app.request(`/api/runs/${run.id}`);
    const snapshot = (await runRes.json()) as {
      run: { status: string; error?: string };
      plan: { steps: Array<{ id: string; status: string }> };
      lastSeq: number;
    };
    expect(snapshot.run.status).toBe('failed');
    expect(snapshot.run.error).toBe(SERVER_RESTART_REASON);
    expect(snapshot.plan.steps.map((s) => s.status)).toEqual(['cancelled', 'cancelled']);
    expect(snapshot.lastSeq).toBe(6);

    const detail = (await (await app.request(`/api/threads/${thread.id}`)).json()) as {
      messages: Array<{ role: string; parts: Array<{ type: string; data?: { status?: string } }> }>;
    };
    expect(detail.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    const runPart = detail.messages[1]!.parts.find((p) => p.type === 'data-run');
    expect(runPart?.data?.status).toBe('failed');

    // Recovery is idempotent: a second boot must not touch the run again.
    await close();
    const again = await createApp({ config, logger });
    const events = (await (await again.app.request(`/api/runs/${run.id}/events`)).json()) as {
      events: unknown[];
    };
    expect(events.events).toHaveLength(6);
    await again.close();
  });

  it('deleting a thread removes its runs, events and messages', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'loop-agent-sqlite-'));
    const { app, ctx, close } = await boot(dataDir);
    const { thread } = (await (
      await app.request('/api/threads', { method: 'POST', body: '{}' })
    ).json()) as { thread: { id: string } };
    const res = await app.request(`/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'delete me' }),
    });
    const runId = res.headers.get('x-run-id')!;
    await res.text();
    await ctx.runManager.wait(runId);

    expect((await app.request(`/api/threads/${thread.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await app.request(`/api/threads/${thread.id}`)).status).toBe(404);
    expect(await ctx.stores.runs.get(runId)).toBeUndefined();
    expect(await ctx.stores.runs.events(runId)).toEqual([]);
    expect(await ctx.stores.threads.messages(thread.id)).toEqual([]);
    await close();
  });
});
