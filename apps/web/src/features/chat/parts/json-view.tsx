import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function formatJson(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}

export function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable
    }
  };
  return { copied, copy };
}

export function JsonView({
  value,
  className,
  maxHeight = 'max-h-64',
}: {
  value: unknown;
  className?: string;
  maxHeight?: string;
}) {
  const text = formatJson(value);
  const { copied, copy } = useCopy(text);
  return (
    <div className={cn('group relative', className)}>
      <pre
        className={cn(
          'overflow-auto rounded-md bg-muted/60 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words',
          maxHeight,
        )}
      >
        {text}
      </pre>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="复制"
        className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={copy}
      >
        {copied ? <Check className="text-success" /> : <Copy />}
      </Button>
    </div>
  );
}
