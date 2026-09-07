import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findDotEnvFiles, loadDotEnv, parseDotEnv } from './load-env.js';

describe('parseDotEnv', () => {
  it('parses keys, quotes, export, and ignores comments', () => {
    const parsed = parseDotEnv(`
# comment
PORT=3001
export LLM_PROVIDER=mock
LLM_MODEL="gpt-4.1"
EMPTY=
export   SEARCH_PROVIDER='none'
not-a-key=1
=novalue
`);
    expect(parsed).toEqual({
      PORT: '3001',
      LLM_PROVIDER: 'mock',
      LLM_MODEL: 'gpt-4.1',
      EMPTY: '',
      SEARCH_PROVIDER: 'none',
    });
  });
});

describe('loadDotEnv', () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it('walks toward the repo root and does not override existing env', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'loop-agent-env-'));
    const nested = path.join(root, 'apps', 'server');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, '.env'), 'FROM_ROOT=yes\nSHARED=root\nPRESET=file\n');
    await writeFile(path.join(nested, '.env'), 'FROM_NESTED=yes\nSHARED=nested\n');

    expect(findDotEnvFiles(nested, 4)).toEqual([
      path.join(nested, '.env'),
      path.join(root, '.env'),
    ]);

    const env: NodeJS.ProcessEnv = { PRESET: 'already' };
    const loaded = loadDotEnv(nested, env);
    expect(loaded).toEqual([path.join(root, '.env'), path.join(nested, '.env')]);
    expect(env).toMatchObject({
      FROM_ROOT: 'yes',
      FROM_NESTED: 'yes',
      SHARED: 'nested',
      PRESET: 'already',
    });
  });
});
