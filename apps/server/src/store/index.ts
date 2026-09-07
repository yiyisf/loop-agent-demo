import { type AppConfig, resolveSqlitePath } from '../config.js';
import type { Logger } from '../lib/logger.js';
import { createMemoryStores } from './memory.js';
import type { Stores } from './types.js';

export type { RunStore, Stores, ThreadStore } from './types.js';

/**
 * File persistence uses Node's built-in `node:sqlite` (no extra native addon).
 * If opening the file fails, fall back to memory so the HTTP server still listens.
 */
export async function createStores(config: AppConfig, logger?: Logger): Promise<Stores> {
  if (resolveSqlitePath(config.DATABASE_URL) === null) {
    logger?.info('using in-memory store');
    return createMemoryStores();
  }
  try {
    const { createSqliteStores } = await import('./sqlite.js');
    const stores = await createSqliteStores({ url: config.DATABASE_URL });
    logger?.info({ database: config.DATABASE_URL }, 'using sqlite store (node:sqlite)');
    return stores;
  } catch (err) {
    logger?.warn(
      { err, database: config.DATABASE_URL },
      'sqlite unavailable; falling back to in-memory store (sessions are lost on restart)',
    );
    return createMemoryStores();
  }
}
