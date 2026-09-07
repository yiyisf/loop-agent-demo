import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadConfig,
  resolveDatabaseUrl,
  sqliteFilePathFromUrl,
  toLibsqlFileUrl,
} from './config.js';

describe('toLibsqlFileUrl', () => {
  it('uses three slashes for Windows drive paths (libsql rejects file:C:\\...)', () => {
    expect(toLibsqlFileUrl('C:\\Users\\me\\data\\loop-agent.db')).toBe(
      'file:///C:/Users/me/data/loop-agent.db',
    );
    expect(toLibsqlFileUrl('C:/Users/me/data/loop-agent.db')).toBe(
      'file:///C:/Users/me/data/loop-agent.db',
    );
  });

  it('uses a WHATWG file URL for POSIX absolute paths', () => {
    expect(toLibsqlFileUrl('/var/data/loop-agent.db')).toBe('file:///var/data/loop-agent.db');
  });
});

describe('resolveDatabaseUrl', () => {
  it('resolves relative file URLs and leaves memory URLs alone', () => {
    expect(resolveDatabaseUrl('memory')).toBe('memory');
    expect(resolveDatabaseUrl('file::memory:?cache=shared')).toBe('file::memory:?cache=shared');
    expect(resolveDatabaseUrl('file:/var/data/app.db')).toBe('file:///var/data/app.db');
    expect(resolveDatabaseUrl('file:./data/loop-agent.db', '/repo')).toBe(
      'file:///repo/data/loop-agent.db',
    );
  });

  it('rewrites the Windows path form that path.resolve would produce', () => {
    expect(resolveDatabaseUrl('file:C:\\repo\\data\\loop-agent.db')).toBe(
      'file:///C:/repo/data/loop-agent.db',
    );
  });
});

describe('sqliteFilePathFromUrl', () => {
  it('round-trips libsql file URLs to filesystem paths', () => {
    expect(sqliteFilePathFromUrl('file:///var/data/app.db')).toBe(
      path.normalize('/var/data/app.db'),
    );
    expect(sqliteFilePathFromUrl('file::memory:?cache=shared')).toBeUndefined();
  });
});

describe('loadConfig', () => {
  it('defaults HOST to 127.0.0.1 so Windows loopback is not firewalled', () => {
    const config = loadConfig({ DATABASE_URL: 'memory' });
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.PORT).toBe(3001);
    expect(config.DATABASE_URL).toBe('memory');
  });
});
