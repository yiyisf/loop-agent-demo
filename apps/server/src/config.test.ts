import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, resolveDatabaseUrl } from './config.js';

describe('resolveDatabaseUrl', () => {
  it('resolves relative file URLs and leaves absolute / memory URLs alone', () => {
    expect(resolveDatabaseUrl('memory')).toBe('memory');
    expect(resolveDatabaseUrl('file::memory:?cache=shared')).toBe('file::memory:?cache=shared');
    expect(resolveDatabaseUrl('file:/var/data/app.db')).toBe('file:/var/data/app.db');
    expect(resolveDatabaseUrl('file:./data/loop-agent.db', '/repo')).toBe(
      `file:${path.resolve('/repo', './data/loop-agent.db')}`,
    );
  });
});

describe('loadConfig', () => {
  it('defaults HOST to 0.0.0.0 so IPv4 clients can reach the server', () => {
    const config = loadConfig({ DATABASE_URL: 'memory' });
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.PORT).toBe(3001);
    expect(config.DATABASE_URL).toBe('memory');
  });
});
