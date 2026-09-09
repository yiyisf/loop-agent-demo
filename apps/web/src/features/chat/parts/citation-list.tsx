import type { Citation } from '@loop-agent/shared';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

function hostname(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function CitationList({ citations }: { citations: Citation[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (citations.length === 0) return null;

  return (
    <div data-testid="citation-list" className="space-y-1.5">
      <p className="text-xs text-muted-foreground">来源 {citations.length}</p>
      <ul className="flex flex-wrap gap-1.5">
        {citations.map((c) => {
          const host = hostname(c.url);
          const open = openId === c.id;
          return (
            <li key={c.id} className="min-w-0">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : c.id)}
                className={cn(
                  'max-w-full truncate rounded-md border px-2 py-1 text-left text-xs hover:bg-accent/60',
                  open && 'border-foreground/30 bg-accent/40',
                )}
              >
                {c.title}
                {host ? <span className="ml-1 text-muted-foreground">{host}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {citations
        .filter((c) => c.id === openId)
        .map((c) => (
          <div
            key={c.id}
            data-testid="citation-excerpt"
            className="rounded-md border bg-card px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          >
            {c.excerpt ? <p className="whitespace-pre-wrap break-words">{c.excerpt}</p> : null}
            {c.url ? (
              <a
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline"
              >
                打开原文
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>
        ))}
    </div>
  );
}
