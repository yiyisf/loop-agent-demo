import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { safeEvaluate } from './calculator.js';
import { assertPublicUrl, htmlToText, isPrivateAddress } from './http-fetch.js';
import { resolveInWorkspace } from './workspace.js';

describe('calculator', () => {
  it('evaluates expressions', () => {
    expect(safeEvaluate('(12 + 30) * 2')).toBe(84);
    expect(String(safeEvaluate('sqrt(16) + 2^3'))).toBe('12');
  });

  it('blocks dangerous functions', () => {
    expect(() => safeEvaluate('import({})')).toThrow();
    expect(() => safeEvaluate('evaluate("1+1")')).toThrow();
    expect(() => safeEvaluate('a'.repeat(600))).toThrow(/too long/);
  });
});

describe('http_fetch safety', () => {
  it('classifies private addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.1.1',
      '::1',
      'fd00::1',
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });

  it('rejects non-http schemes, localhost and private IPs', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/Only http/);
    await expect(assertPublicUrl('http://localhost:3001/health')).rejects.toThrow(/local/);
    await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toThrow(/private/);
    await expect(assertPublicUrl('http://[::1]/')).rejects.toThrow(/private/);
    await expect(assertPublicUrl('not a url')).rejects.toThrow(/Invalid URL/);
  });

  it('converts html to readable text', () => {
    const text = htmlToText(
      '<html><head><title>Hello</title><style>p{}</style></head><body><h1>Title</h1><p>A &amp; B</p><script>x()</script><ul><li>one</li><li>two</li></ul></body></html>',
    );
    expect(text).toContain('# Hello');
    expect(text).toContain('A & B');
    expect(text).toContain('- one');
    expect(text).not.toContain('x()');
  });
});

describe('workspace paths', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ws-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves inside the workspace and blocks traversal', () => {
    expect(resolveInWorkspace(dir, 'notes/a.md')).toBe(path.join(dir, 'notes', 'a.md'));
    expect(resolveInWorkspace(dir, '/abs.md')).toBe(path.join(dir, 'abs.md'));
    expect(() => resolveInWorkspace(dir, '../escape.md')).toThrow(/escapes/);
    expect(() => resolveInWorkspace(dir, 'a/../../escape.md')).toThrow(/escapes/);
  });
});
