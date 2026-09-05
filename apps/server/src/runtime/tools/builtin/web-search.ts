import { tool } from 'ai';
import { z } from 'zod';
import type { AppConfig } from '../../../config.js';
import type { ToolDefinition } from '../types.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function tavily(query: string, key: string, max: number, signal?: AbortSignal) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: max, include_answer: false }),
    signal,
  });
  if (!res.ok) throw new Error(`Tavily error ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{ title: string; url: string; content: string }>;
  };
  return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
}

async function exa(query: string, key: string, max: number, signal?: AbortSignal) {
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ query, numResults: max, contents: { highlights: true } }),
    signal,
  });
  if (!res.ok) throw new Error(`Exa error ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{ title: string; url: string; highlights?: string[]; text?: string }>;
  };
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: (r.highlights ?? []).join(' ') || (r.text ?? '').slice(0, 300),
  }));
}

async function brave(query: string, key: string, max: number, signal?: AbortSignal) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(max));
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'x-subscription-token': key },
    signal,
  });
  if (!res.ok) throw new Error(`Brave error ${res.status}`);
  const data = (await res.json()) as {
    web?: { results?: Array<{ title: string; url: string; description: string }> };
  };
  return (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));
}

export async function webSearch(
  config: AppConfig,
  query: string,
  max = 6,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const key = config.SEARCH_API_KEY;
  if (!key) throw new Error('SEARCH_API_KEY is not configured');
  switch (config.SEARCH_PROVIDER) {
    case 'tavily':
      return tavily(query, key, max, signal);
    case 'exa':
      return exa(query, key, max, signal);
    case 'brave':
      return brave(query, key, max, signal);
    default:
      throw new Error('No search provider configured');
  }
}

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web and return the top results (title, url, snippet).',
  risk: 'low',
  category: 'search',
  plannable: true,
  disabledReason: (config) =>
    config.SEARCH_PROVIDER === 'none' || !config.SEARCH_API_KEY
      ? 'SEARCH_PROVIDER / SEARCH_API_KEY not configured'
      : undefined,
  create: (rt) =>
    tool({
      description:
        'Search the web. Returns up to `maxResults` results with title, url and snippet. Follow up with http_fetch to read a page in full.',
      inputSchema: z.object({
        query: z.string().min(1).max(300),
        maxResults: z.number().int().min(1).max(10).default(6),
      }),
      execute: async ({ query, maxResults }) => {
        try {
          const results = await webSearch(rt.config, query, maxResults, rt.signal);
          return { query, results };
        } catch (err) {
          return { query, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
};
