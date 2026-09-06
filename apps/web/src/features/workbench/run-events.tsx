import type { RunEvent } from '@loop-agent/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { JsonView } from '@/features/chat/parts/json-view';
import { api, queryKeys } from '@/lib/api';
import { cn } from '@/lib/utils';

const TYPE_TONE: Record<string, string> = {
  'run.status': 'text-primary',
  'plan.created': 'text-info',
  'plan.revised': 'text-warning',
  'step.status': 'text-foreground',
  'step.result': 'text-success',
  'tool.call': 'text-muted-foreground',
  'tool.result': 'text-muted-foreground',
  reflection: 'text-warning',
  'approval.requested': 'text-warning',
  'user_question.asked': 'text-info',
  error: 'text-destructive',
  log: 'text-muted-foreground',
};

function summarize(e: RunEvent): string {
  switch (e.type) {
    case 'run.status':
      return e.reason ? `${e.status} — ${e.reason}` : e.status;
    case 'plan.created':
      return `v${e.plan.revision} · ${e.plan.steps.length} 步`;
    case 'plan.revised':
      return `v${e.plan.revision} · +${e.diff.added.length} ~${e.diff.updated.length} -${e.diff.removed.length}`;
    case 'step.status':
      return `${e.stepId} → ${e.status}${e.error ? ` (${e.error})` : ''}`;
    case 'step.result':
      return `${e.stepId}: ${e.result.status} — ${e.result.summary.slice(0, 80)}`;
    case 'tool.call':
      return `${e.stepId} · ${e.toolName}`;
    case 'tool.result':
      return `${e.stepId} · ${e.toolName}${e.isError ? ' ✗' : ' ✓'}${e.durationMs ? ` ${e.durationMs}ms` : ''}`;
    case 'reflection':
      return `${e.stepId} → ${e.decision.action}`;
    case 'approval.requested':
      return `${e.toolName} (${e.stepId})`;
    case 'approval.resolved':
      return e.approved ? '批准' : '拒绝';
    case 'user_question.asked':
      return e.question.slice(0, 80);
    case 'user_question.answered':
      return e.answer.slice(0, 80);
    case 'usage':
      return `+${e.usage.totalTokens ?? 0} tokens`;
    case 'log':
      return `[${e.level}] ${e.message.slice(0, 100)}`;
    case 'error':
      return e.message.slice(0, 100);
    case 'final.done':
      return `${e.answer.length} 字`;
    default:
      return '';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleTimeString('zh-CN', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/** Debug view: the raw, ordered event log that everything else is projected from. */
export function RunEvents({ runId, live }: { runId: string; live: boolean }) {
  const [openSeq, setOpenSeq] = useState<number | null>(null);
  const events = useQuery({
    queryKey: queryKeys.runEvents(runId),
    queryFn: () => api.getRunEvents(runId, 1000),
    refetchInterval: (q) => (live || q.state.data?.active ? 1500 : false),
  });

  if (events.isLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Spinner />
      </div>
    );
  }
  if (events.isError) {
    return <p className="p-4 text-center text-xs text-destructive">事件加载失败</p>;
  }
  const list = events.data?.events ?? [];
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-muted-foreground">
        <span>{list.length} 条事件（不含流式增量）</span>
        {events.data?.active && <span className="text-info">实时更新</span>}
      </div>
      <ol className="divide-y">
        {list.map((e) => {
          const open = openSeq === e.seq;
          return (
            <li key={e.seq}>
              <button
                type="button"
                onClick={() => setOpenSeq(open ? null : e.seq)}
                className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-accent/50"
              >
                <ChevronRight
                  className={cn('mt-0.5 size-3 shrink-0 transition-transform', open && 'rotate-90')}
                />
                <span className="w-8 shrink-0 text-right font-mono text-muted-foreground">
                  {e.seq}
                </span>
                <span className="w-24 shrink-0 font-mono text-muted-foreground">
                  {formatTime(e.ts)}
                </span>
                <span className={cn('shrink-0 font-medium', TYPE_TONE[e.type] ?? '')}>
                  {e.type}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {summarize(e)}
                </span>
              </button>
              {open && (
                <div className="px-3 pb-2">
                  <JsonView value={e} maxHeight="max-h-72" />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
