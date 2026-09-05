import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { AppConfig } from './config.js';
import type { Logger } from './lib/logger.js';
import { createModelProvider, type ModelProvider } from './providers/model-provider.js';
import { metaRoutes } from './routes/meta.js';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  modelProvider?: ModelProvider;
}

export interface AppContext {
  config: AppConfig;
  logger: Logger;
  modelProvider: ModelProvider;
}

export async function createApp(deps: AppDeps) {
  const ctx: AppContext = {
    config: deps.config,
    logger: deps.logger,
    modelProvider: deps.modelProvider ?? createModelProvider(deps.config),
  };

  const app = new Hono();

  app.use(
    '/api/*',
    cors({
      origin: ctx.config.WEB_ORIGIN.split(',').map((s) => s.trim()),
      exposeHeaders: ['x-run-id', 'x-thread-id'],
    }),
  );

  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    if (c.req.path !== '/health') {
      ctx.logger.debug(
        { method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start },
        'request',
      );
    }
  });

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/api', metaRoutes(ctx));

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    ctx.logger.error({ err }, 'unhandled error');
    return c.json({ error: 'Internal server error' }, 500);
  });

  return { app, ctx };
}
