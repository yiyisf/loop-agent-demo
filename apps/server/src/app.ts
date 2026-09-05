import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { AppConfig } from './config.js';
import type { Logger } from './lib/logger.js';
import { createModelProvider, type ModelProvider } from './providers/model-provider.js';
import { metaRoutes } from './routes/meta.js';
import { runRoutes } from './routes/runs.js';
import { threadRoutes } from './routes/threads.js';
import { EventBus } from './runtime/event-bus.js';
import { recoverInterruptedRuns } from './runtime/recovery.js';
import { RunManager } from './runtime/run-manager.js';
import { generateThreadTitle } from './runtime/title.js';
import { createDefaultToolRegistry } from './runtime/tools/builtin/index.js';
import type { ToolRegistry } from './runtime/tools/registry.js';
import { buildAssistantMessage } from './runtime/ui-stream.js';
import { createStores } from './store/index.js';
import type { Stores } from './store/types.js';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  modelProvider?: ModelProvider;
  tools?: ToolRegistry;
  stores?: Stores;
}

export interface AppContext {
  config: AppConfig;
  logger: Logger;
  modelProvider: ModelProvider;
  tools: ToolRegistry;
  stores: Stores;
  bus: EventBus;
  runManager: RunManager;
}

export async function createApp(deps: AppDeps) {
  const { config, logger } = deps;
  const stores = deps.stores ?? (await createStores(config));
  const tools = deps.tools ?? createDefaultToolRegistry(config);
  const modelProvider = deps.modelProvider ?? createModelProvider(config);

  const bus = new EventBus({
    sink: (event) => stores.runs.appendEvent(event),
    loadHistory: (runId, fromSeq) => stores.runs.events(runId, fromSeq, 10_000),
  });

  const runManager = new RunManager({
    config,
    logger,
    bus,
    models: modelProvider,
    tools,
    onRunCreated: (run) => stores.runs.create(run),
    onRunFinished: async (snapshot) => {
      const { run } = snapshot;
      await stores.runs.saveSnapshot(snapshot);
      await stores.threads.appendMessage(run.threadId, buildAssistantMessage(snapshot));

      const runs = await stores.runs.listByThread(run.threadId);
      if (runs.length === 1 && run.status === 'succeeded') {
        const title = await generateThreadTitle(modelProvider, logger, {
          input: run.input,
          answer: run.finalAnswer,
          model: run.model,
        });
        await stores.threads.updateTitle(run.threadId, title);
      }
    },
  });

  await recoverInterruptedRuns(stores, logger);

  const ctx: AppContext = { config, logger, modelProvider, tools, stores, bus, runManager };

  const app = new Hono();

  app.use(
    '/api/*',
    cors({
      origin: config.WEB_ORIGIN.split(',').map((s) => s.trim()),
      exposeHeaders: ['x-run-id', 'x-thread-id'],
    }),
  );

  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    if (c.req.path !== '/health') {
      logger.debug(
        { method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start },
        'request',
      );
    }
  });

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/api', metaRoutes(ctx));
  app.route('/api/threads', threadRoutes(ctx));
  app.route('/api/runs', runRoutes(ctx));

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    logger.error({ err }, 'unhandled error');
    return c.json({ error: 'Internal server error' }, 500);
  });

  const close = async () => {
    await runManager.shutdown();
    await stores.close();
  };

  return { app, ctx, close };
}
