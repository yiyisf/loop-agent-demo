import type { ToolCallRecord } from '@loop-agent/shared';
import { ChevronRight, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Spinner } from '@/components/ui/spinner';
import { cn, formatDuration } from '@/lib/utils';
import { JsonView } from './json-view';

function inputPreview(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input;
  if (typeof input === 'object') {
    const entries = Object.entries(input as Record<string, unknown>);
    const first = entries[0];
    if (!first) return '';
    const v = typeof first[1] === 'string' ? first[1] : JSON.stringify(first[1]);
    return `${first[0]}: ${v}`;
  }
  return String(input);
}

export function ToolCallCard({
  call,
  compact = false,
}: {
  call: ToolCallRecord;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const preview = inputPreview(call.input);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          'rounded-lg border bg-card text-sm',
          call.isError && 'border-destructive/40',
          compact && 'text-xs',
        )}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50"
          >
            <ChevronRight
              className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
            />
            <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono font-medium">{call.toolName}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={preview}>
              {preview}
            </span>
            {call.state === 'calling' ? (
              <Spinner className="size-3.5" />
            ) : call.isError ? (
              <Badge variant="destructive">错误</Badge>
            ) : (
              <span className="text-xs text-muted-foreground">
                {call.durationMs !== undefined ? formatDuration(call.durationMs) : ''}
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid gap-2 border-t px-3 py-2">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">输入</p>
              <JsonView value={call.input} maxHeight="max-h-48" />
            </div>
            {call.state === 'done' && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">输出</p>
                <JsonView value={call.output} maxHeight="max-h-64" />
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
