import type { RunStatus } from '@loop-agent/shared';
import { runStatusLabel } from '@/lib/run-view';

export function StatusPill({ status, reason }: { status: RunStatus | undefined; reason?: string }) {
  if (!status) return null;
  return (
    <span className="text-xs text-muted-foreground" title={reason}>
      {runStatusLabel[status]}
    </span>
  );
}
