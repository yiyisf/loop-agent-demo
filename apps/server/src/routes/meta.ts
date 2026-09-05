import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { availableModels } from '../config.js';

export function metaRoutes(ctx: AppContext) {
  const router = new Hono();

  router.get('/models', (c) =>
    c.json({
      provider: ctx.config.LLM_PROVIDER,
      default: ctx.config.LLM_MODEL,
      models: availableModels(ctx.config),
    }),
  );

  router.get('/tools', (c) => c.json({ tools: ctx.tools.list() }));

  return router;
}
