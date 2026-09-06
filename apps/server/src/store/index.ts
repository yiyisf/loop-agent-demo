import type { AppConfig } from '../config.js';
import { createMemoryStores } from './memory.js';
import { createSqliteStores } from './sqlite.js';
import type { Stores } from './types.js';

export type { RunStore, Stores, ThreadStore } from './types.js';

/** `DATABASE_URL=memory` keeps everything in-process (tests, ephemeral demos). */
export async function createStores(config: AppConfig): Promise<Stores> {
  if (config.DATABASE_URL === 'memory') return createMemoryStores();
  return createSqliteStores({ url: config.DATABASE_URL });
}
