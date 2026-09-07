import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createStores } from './index.js';

const logger = pino({ level: 'silent' });

describe('createStores', () => {
  it('uses memory when DATABASE_URL=memory', async () => {
    const stores = await createStores(loadConfig({ DATABASE_URL: 'memory' }), logger);
    expect(stores.kind).toBe('memory');
    await stores.close();
  });

  it('falls back to memory when the sqlite file cannot be opened so the API can still listen', async () => {
    const stores = await createStores(loadConfig({ DATABASE_URL: '/tmp' }), logger);
    expect(stores.kind).toBe('memory');
    await stores.close();
  });
});
