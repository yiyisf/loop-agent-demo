import type { Approval } from '@loop-agent/shared';
import { Check, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useRunStore } from '@/stores/run-store';
import { JsonView } from './json-view';

export interface ApprovalCardProps {
  approval: Approval;
  /** Whether the run is live and can still receive a decision. */
  interactive: boolean;
}

export function ApprovalCard({ approval, interactive }: ApprovalCardProps) {
  const pushNotice = useRunStore((s) => s.pushNotice);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const pending = approval.status === 'pending';

  const decide = async (approved: boolean) => {
    setBusy(approved ? 'approve' : 'deny');
    try {
      await api.respondApproval(approval.runId, approval.id, approved, reason);
    } catch (err) {
      pushNotice('error', err instanceof Error ? err.message : '提交审批失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={cn(
        'rounded-xl border bg-card text-sm',
        pending && interactive && 'border-warning/60 shadow-sm ring-2 ring-warning/15',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <ShieldAlert
          className={cn('size-4 shrink-0', pending ? 'text-warning' : 'text-muted-foreground')}
        />
        <span className="font-medium">工具审批</span>
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{approval.toolName}</code>
        <span className="text-xs text-muted-foreground">步骤 {approval.stepId}</span>
        <span className="ml-auto">
          {approval.status === 'approved' && (
            <Badge variant="success">
              <Check /> 已批准
            </Badge>
          )}
          {approval.status === 'denied' && (
            <Badge variant="destructive">
              <X /> 已拒绝
            </Badge>
          )}
          {pending && <Badge variant="warning">{interactive ? '等待你的决定' : '待处理'}</Badge>}
        </span>
      </div>
      <div className="grid gap-2 border-t px-3 py-2.5">
        {approval.reason && <p className="text-xs text-muted-foreground">{approval.reason}</p>}
        <JsonView value={approval.input} maxHeight="max-h-40" />
        {approval.status !== 'pending' && approval.resolution && (
          <p className="text-xs text-muted-foreground">备注：{approval.resolution}</p>
        )}
        {pending && interactive && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input
              type="text"
              name={`approval-reason-${approval.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="备注（可选）"
              aria-label="审批备注"
              className="h-8 min-w-40 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => decide(false)}
            >
              <X /> 拒绝
            </Button>
            <Button type="button" size="sm" disabled={busy !== null} onClick={() => decide(true)}>
              <Check /> 批准执行
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
