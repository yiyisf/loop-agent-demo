import type { Approval, RunEvent } from '@loop-agent/shared';

/**
 * Folds `approval.requested` / `approval.resolved` events into approval rows.
 * Shared by the memory and SQLite stores so both expose the same view.
 */
export function applyApprovalEvent(
  approvals: Map<string, Approval>,
  event: RunEvent,
): Approval | undefined {
  switch (event.type) {
    case 'approval.requested': {
      const approval: Approval = {
        id: event.approvalId,
        runId: event.runId,
        stepId: event.stepId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
        reason: event.reason,
        status: 'pending',
        createdAt: event.ts,
      };
      approvals.set(approval.id, approval);
      return approval;
    }
    case 'approval.resolved': {
      const existing = approvals.get(event.approvalId);
      if (!existing) return undefined;
      const resolved: Approval = {
        ...existing,
        status: event.approved ? 'approved' : 'denied',
        resolution: event.reason,
        resolvedAt: event.ts,
      };
      approvals.set(resolved.id, resolved);
      return resolved;
    }
    default:
      return undefined;
  }
}
