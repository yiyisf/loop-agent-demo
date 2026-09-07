import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { loadDotEnv } from './lib/load-env.js';
import { createLogger } from './lib/logger.js';

loadDotEnv();

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

const publicUrl = (address: string, port: number) => {
  const host = address === '0.0.0.0' || address === '::' ? '127.0.0.1' : address;
  const bracket = host.includes(':') ? `[${host}]` : host;
  return `http://${bracket}:${port}`;
};

try {
  const { createApp } = await import('./app.js');
  const { app, close } = await createApp({ config, logger });

  const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
    logger.info(
      {
        host: info.address,
        port: info.port,
        url: publicUrl(info.address, info.port),
        provider: config.LLM_PROVIDER,
        model: config.LLM_MODEL,
        database: config.DATABASE_URL,
      },
      'loop-agent server listening',
    );
  });

  server.on('error', (err) => {
    logger.fatal({ err }, 'HTTP server failed');
    process.exit(1);
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
} catch (err) {
  const reason = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`\n[server] failed to listen on ${config.HOST}:${config.PORT}\n${reason}\n`);
  logger.fatal({ err }, 'failed to start server');
  process.exit(1);
}
