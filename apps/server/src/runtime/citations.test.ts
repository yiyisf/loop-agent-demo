import { describe, expect, it } from 'vitest';
import { citationsFromTool } from './citations.js';

describe('citationsFromTool', () => {
  it('builds a citation from http_fetch output', () => {
    const cites = citationsFromTool('http_fetch', {
      url: 'https://example.com/',
      text: '# Example Domain\n\nThis domain is for use in documentation.',
    });
    expect(cites).toHaveLength(1);
    expect(cites[0]).toMatchObject({
      title: 'Example Domain',
      url: 'https://example.com/',
      source: 'http_fetch',
    });
    expect(cites[0]?.excerpt).toContain('documentation');
  });

  it('builds citations from web_search results', () => {
    const cites = citationsFromTool('web_search', {
      query: 'vite',
      results: [
        { title: 'Vite', url: 'https://vite.dev', snippet: 'Next generation frontend tooling' },
        { url: 'https://example.com/x' },
      ],
    });
    expect(cites).toHaveLength(2);
    expect(cites[0]).toMatchObject({ title: 'Vite', source: 'web_search' });
    expect(cites[1]?.title).toBe('https://example.com/x');
  });

  it('ignores errors and unknown tools', () => {
    expect(citationsFromTool('http_fetch', { url: 'https://x', error: 'blocked' })).toEqual([]);
    expect(citationsFromTool('calculator', { result: 1 })).toEqual([]);
  });
});
