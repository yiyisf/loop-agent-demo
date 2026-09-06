import type { RunStatus } from '@loop-agent/shared';
import { AlertCircle, Ban, CheckCircle2, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { runStatusLabel } from '@/lib/run-view';

export function StatusPill({ status, reason }: { status: RunStatus | undefined; reason?: string }) {
  if (!status) return null;
  switch (status) {
    case 'succeeded':
      return (
        <Badge variant="success">
          <CheckCircle2 />
          {runStatusLabel[status]}
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive" title={reason}>
          <AlertCircle />
          {runStatusLabel[status]}
        </Badge>
      );
    case 'cancelled':
      return (
        <Badge variant="secondary" title={reason}>
          <Ban />
          {runStatusLabel[status]}
        </Badge>
      );
    case 'awaiting_approval':
    case 'awaiting_user':
    case 'awaiting_plan_confirmation':
      return <Badge variant="warning">{runStatusLabel[status]}</Badge>;
    default:
      return (
        <Badge variant="info">
          <Loader2 className="animate-spin" />
          {runStatusLabel[status]}
        </Badge>
      );
  }
}
