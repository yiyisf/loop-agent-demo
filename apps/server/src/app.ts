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
import { RunManager } from './runtime/run-manager.js';
import { createDefaultToolRegistry } from './runtime/tools/builtin/index.js';
import type { ToolRegistry } from './runtime/tools/registry.js';
import { buildAssistantMessage } from './runtime/ui-stream.js';
import { createMemoryStores } from './store/memory.js';
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
  const stores = deps.stores ?? createMemoryStores();
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
    onRunFinished: async (snapshot) => {
      await stores.runs.saveSnapshot(snapshot);
      await stores.threads.appendMessage(snapshot.run.threadId, buildAssistantMessage(snapshot));
    },
  });

  const interrupted = await stores.runs.failInterrupted(
    'Server restarted while the run was in progress',
  );
  if (interrupted > 0) logger.warn({ interrupted }, 'marked interrupted runs as failed');

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

  return { app, ctx };
}
