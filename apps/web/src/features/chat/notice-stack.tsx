import { AlertTriangle, Info, X, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useRunStore } from '@/stores/run-store';

export function NoticeStack() {
  const notices = useRunStore((s) => s.notices);
  const dismiss = useRunStore((s) => s.dismissNotice);

  useEffect(() => {
    if (notices.length === 0) return;
    const timer = setTimeout(() => {
      const oldest = notices[0];
      if (oldest && oldest.level !== 'error') dismiss(oldest.id);
    }, 6000);
    return () => clearTimeout(timer);
  }, [notices, dismiss]);

  if (notices.length === 0) return null;
  return (
    <div className="mb-2 grid gap-1.5">
      {notices.map((n) => (
        <div
          key={n.id}
          className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
            n.level === 'error' && 'border-destructive/40 bg-destructive/5 text-destructive',
            n.level === 'warn' && 'border-warning/50 bg-warning/10 text-warning',
            n.level === 'info' && 'border-info/40 bg-info/5 text-info',
          )}
        >
          {n.level === 'error' ? (
            <XCircle className="mt-0.5 size-3.5 shrink-0" />
          ) : n.level === 'warn' ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <Info className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span className="flex-1">{n.message}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-5"
            aria-label="关闭"
            onClick={() => dismiss(n.id)}
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
