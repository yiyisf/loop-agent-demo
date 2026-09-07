import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, resolveSqlitePath } from './config.js';

describe('resolveSqlitePath', () => {
  it('treats memory URLs as in-process', () => {
    expect(resolveSqlitePath('memory')).toBeNull();
    expect(resolveSqlitePath(':memory:')).toBeNull();
    expect(resolveSqlitePath('file::memory:?cache=shared')).toBeNull();
  });

  it('resolves POSIX file URLs and relative paths', () => {
    expect(resolveSqlitePath('file:/var/data/app.db')).toBe(path.normalize('/var/data/app.db'));
    expect(resolveSqlitePath('file:///var/data/app.db')).toBe(path.normalize('/var/data/app.db'));
    expect(resolveSqlitePath('file:./data/loop-agent.db', '/repo')).toBe(
      path.resolve('/repo', './data/loop-agent.db'),
    );
  });

  it('keeps Windows drive paths as native filesystem paths (node:sqlite, not file: URLs)', () => {
    expect(resolveSqlitePath('file:C:\\repo\\data\\loop-agent.db')).toBe(
      'C:\\repo\\data\\loop-agent.db',
    );
    expect(resolveSqlitePath('C:/repo/data/loop-agent.db')).toBe('C:/repo/data/loop-agent.db');
  });
});

describe('loadConfig', () => {
  it('defaults HOST to 127.0.0.1 so the Vite proxy target works on every OS', () => {
    const config = loadConfig({ DATABASE_URL: 'memory' });
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.PORT).toBe(3001);
    expect(config.DATABASE_URL).toBe('memory');
  });
});
