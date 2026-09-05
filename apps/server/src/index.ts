import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const { app } = await createApp({ config, logger });

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info(
    { port: info.port, provider: config.LLM_PROVIDER, model: config.LLM_MODEL },
    'loop-agent server listening',
  );
});
