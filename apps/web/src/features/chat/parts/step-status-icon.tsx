import type { StepStatus } from '@loop-agent/shared';
import {
  Ban,
  Check,
  Circle,
  CircleDashed,
  Clock,
  Hand,
  Loader2,
  MessageCircleQuestion,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const styles: Record<StepStatus, { icon: typeof Check; className: string }> = {
  pending: { icon: Circle, className: 'text-muted-foreground/60' },
  ready: { icon: Clock, className: 'text-muted-foreground' },
  running: { icon: Loader2, className: 'animate-spin text-foreground' },
  succeeded: { icon: Check, className: 'text-foreground' },
  failed: { icon: X, className: 'text-destructive' },
  skipped: { icon: CircleDashed, className: 'text-muted-foreground' },
  blocked: { icon: Ban, className: 'text-muted-foreground' },
  cancelled: { icon: Ban, className: 'text-muted-foreground' },
  waiting_approval: { icon: Hand, className: 'text-foreground' },
  waiting_user: { icon: MessageCircleQuestion, className: 'text-foreground' },
};

export function StepStatusIcon({ status, className }: { status: StepStatus; className?: string }) {
  const { icon: Icon, className: color } = styles[status];
  return <Icon className={cn('size-4 shrink-0', color, className)} aria-hidden />;
}

export function stepStatusRing(status: StepStatus): string {
  switch (status) {
    case 'running':
      return 'border-foreground/25 bg-muted/40';
    case 'succeeded':
      return 'border-border';
    case 'failed':
      return 'border-destructive/40 bg-destructive/5';
    case 'waiting_approval':
    case 'waiting_user':
      return 'border-foreground/20 bg-muted/50';
    default:
      return 'border-border';
  }
}
