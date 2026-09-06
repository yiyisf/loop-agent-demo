import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const { app, close } = await createApp({ config, logger });

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info(
    {
      port: info.port,
      provider: config.LLM_PROVIDER,
      model: config.LLM_MODEL,
      database: config.DATABASE_URL,
    },
    'loop-agent server listening',
  );
});

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  server.close();
  const timer = setTimeout(() => process.exit(1), 10_000);
  timer.unref();
  try {
    await close();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
