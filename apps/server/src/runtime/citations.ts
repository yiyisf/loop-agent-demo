import type { Citation } from '@loop-agent/shared';
import { newId } from '../lib/ids.js';
import type { RunContext } from './engine/context.js';

function asRecord(output: unknown): Record<string, unknown> | null {
  return output && typeof output === 'object' && !Array.isArray(output)
    ? (output as Record<string, unknown>)
    : null;
}

function excerptOf(text: string, max = 240): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function titleFromFetch(url: string, text: string): string {
  const heading = /^#\s+(.+)$/m.exec(text);
  if (heading?.[1]) return heading[1].trim();
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function citationsFromTool(toolName: string, output: unknown): Citation[] {
  const rec = asRecord(output);
  if (!rec || rec.error) return [];

  if (toolName === 'http_fetch' && typeof rec.url === 'string' && typeof rec.text === 'string') {
    return [
      {
        id: newId('cite'),
        title: titleFromFetch(rec.url, rec.text),
        url: rec.url,
        source: 'http_fetch',
        excerpt: excerptOf(rec.text),
      },
    ];
  }

  if (toolName === 'web_search' && Array.isArray(rec.results)) {
    return rec.results
      .filter(
        (r): r is { title?: unknown; url?: unknown; snippet?: unknown } =>
          !!r && typeof r === 'object',
      )
      .slice(0, 8)
      .map((r) => ({
        id: newId('cite'),
        title:
          typeof r.title === 'string' && r.title.trim() ? r.title : String(r.url ?? '搜索结果'),
        url: typeof r.url === 'string' ? r.url : undefined,
        source: 'web_search' as const,
        excerpt: typeof r.snippet === 'string' ? excerptOf(r.snippet) : undefined,
      }));
  }

  return [];
}

export function emitToolCitations(ctx: RunContext, toolName: string, output: unknown): void {
  for (const citation of citationsFromTool(toolName, output)) {
    ctx.emit({ type: 'citation.added', citation });
  }
}
