import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const MAX_BYTES = 400_000;
const MAX_TEXT = 20_000;
const TIMEOUT_MS = 15_000;

/** True for loopback, link-local, private and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number, number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // unique local
  if (v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb'))
    return true;
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return false;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs are allowed (got ${url.protocol})`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error('Access to local/internal hosts is not allowed');
  }
  if (isIP(host)) {
    if (isPrivateAddress(host))
      throw new Error('Access to private network addresses is not allowed');
    return url;
  }
  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new Error(`Could not resolve host ${host}`);
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error('Host resolves to a private network address; access denied');
  }
  return url;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

export function htmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, '');
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const text = withoutBlocks
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (m, e: string) => {
      if (ENTITIES[e]) return ENTITIES[e];
      if (e.startsWith('#x')) return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
      if (e.startsWith('#')) return String.fromCodePoint(Number(e.slice(1)));
      return m;
    })
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const title = titleMatch?.[1]?.trim();
  return title ? `# ${title}\n\n${text}` : text;
}

export async function fetchAsText(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<{ url: string; status: number; contentType: string; text: string; truncated: boolean }> {
  const url = await assertPublicUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'loop-agent/0.1 (+https://github.com/yiyisf/loop-agent-demo)',
        accept: 'text/html,application/json,text/plain,*/*;q=0.8',
      },
    });
    const contentType = res.headers.get('content-type') ?? '';
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let truncated = false;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        chunks.push(value);
        if (received > MAX_BYTES) {
          truncated = true;
          await reader.cancel();
          break;
        }
      }
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    let text: string;
    if (contentType.includes('html')) text = htmlToText(raw);
    else if (contentType.includes('json')) {
      try {
        text = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        text = raw;
      }
    } else text = raw;
    if (text.length > MAX_TEXT) {
      text = `${text.slice(0, MAX_TEXT)}\n\n[... truncated ${text.length - MAX_TEXT} characters]`;
      truncated = true;
    }
    return { url: res.url, status: res.status, contentType, text, truncated };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export const httpFetchTool: ToolDefinition = {
  name: 'http_fetch',
  description:
    'Fetch a public web page or JSON API via HTTP GET and return its readable text content (HTML is converted to text, long content is truncated).',
  risk: 'medium',
  category: 'fetch',
  plannable: true,
  create: (rt) =>
    tool({
      description:
        'HTTP GET a public URL and return readable text. Use for reading documentation pages, articles or JSON APIs. Private/internal addresses are blocked.',
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        try {
          return await fetchAsText(url, rt.signal);
        } catch (err) {
          return { url, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
};
