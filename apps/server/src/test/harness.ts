import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RunEvent } from '@loop-agent/shared';
import pino from 'pino';
import { createApp } from '../app.js';
import { type AppConfig, loadConfig } from '../config.js';
import { defaultMockScript, type MockScript } from '../providers/mock-model.js';
import { createModelProvider } from '../providers/model-provider.js';

export interface TestHarnessOptions {
  script?: MockScript;
  env?: Record<string, string>;
}

export async function createTestHarness(options: TestHarnessOptions = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'loop-agent-test-'));
  const config: AppConfig = loadConfig({
    LLM_PROVIDER: 'mock',
    DATA_DIR: dataDir,
    LOG_LEVEL: 'silent',
    BUDGET_MAX_DURATION_MS: '60000',
    ...options.env,
  });
  const logger = pino({ level: 'silent' });
  const modelProvider = createModelProvider(config, {
    mockScript: options.script ?? defaultMockScript,
  });
  const { app, ctx } = await createApp({ config, logger, modelProvider });

  const startRun = async (text: string, extra: Record<string, unknown> = {}) => {
    const thread = await ctx.stores.threads.create();
    const res = await app.request(`/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...extra }),
    });
    const runId = res.headers.get('x-run-id');
    if (!runId) throw new Error(`no run id (status ${res.status}: ${await res.text()})`);
    return { thread, res, runId };
  };

  const collectEvents = async (runId: string): Promise<RunEvent[]> => {
    await ctx.runManager.wait(runId);
    return ctx.bus.buffered(runId, 0);
  };

  const readSse = async (res: Response): Promise<Array<Record<string, unknown>>> => {
    const text = await res.text();
    return text
      .split('\n')
      .filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'))
      .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
  };

  const cleanup = async () => {
    await ctx.runManager.shutdown();
    await rm(dataDir, { recursive: true, force: true });
  };

  return { app, ctx, config, startRun, collectEvents, readSse, cleanup };
}
