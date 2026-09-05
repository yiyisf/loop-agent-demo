import type { Plan, PlanDiff, Step, ToolCallRecord } from '@loop-agent/shared';
import { ChevronRight, GitBranch, ListChecks } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { stepStatusLabel } from '@/lib/run-view';
import { cn, formatDuration } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';
import { StepStatusIcon, stepStatusRing } from './step-status-icon';

export interface PlanCardProps {
  plan: Plan;
  steps: Step[];
  toolCalls: ToolCallRecord[];
  diff?: PlanDiff;
  reason?: string;
  defaultOpen?: boolean;
}

function stepDuration(step: Step): string | null {
  if (!step.startedAt) return null;
  const end = step.endedAt ? new Date(step.endedAt).getTime() : Date.now();
  return formatDuration(end - new Date(step.startedAt).getTime());
}

export function PlanCard({
  plan,
  steps,
  toolCalls,
  diff,
  reason,
  defaultOpen = true,
}: PlanCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const selectStep = useUiStore((s) => s.selectStep);
  const setWorkbenchOpen = useUiStore((s) => s.setWorkbenchOpen);
  const selectedStepId = useUiStore((s) => s.selectedStepId);

  const done = steps.filter((s) => s.status === 'succeeded' || s.status === 'skipped').length;
  const failed = steps.filter((s) => s.status === 'failed' || s.status === 'blocked').length;
  const progress = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const toolsByStep = new Map<string, number>();
  for (const t of toolCalls) toolsByStep.set(t.stepId, (toolsByStep.get(t.stepId) ?? 0) + 1);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-xl border bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-t-xl px-3 py-2.5 text-left text-sm hover:bg-accent/50"
          >
            <ChevronRight
              className={cn('size-4 shrink-0 transition-transform', open && 'rotate-90')}
            />
            <ListChecks className="size-4 shrink-0 text-primary" />
            <span className="font-medium">计划</span>
            <Badge variant="secondary">v{plan.revision}</Badge>
            {diff && (
              <Badge variant="warning" title={reason}>
                <GitBranch />
                已调整
              </Badge>
            )}
            <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              {done}/{steps.length} 步
              {failed > 0 && <span className="text-destructive">{failed} 失败</span>}
            </span>
          </button>
        </CollapsibleTrigger>

        <div className="h-1 w-full overflow-hidden bg-muted">
          <div
            className={cn(
              'h-full transition-all duration-300',
              failed ? 'bg-destructive/70' : 'bg-primary',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        <CollapsibleContent>
          <div className="px-3 pt-2 pb-3">
            <p className="mb-2 text-xs text-muted-foreground">{plan.objective}</p>
            {reason && (
              <p className="mb-2 rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
                调整原因：{reason}
              </p>
            )}
            <ol className="grid gap-1.5">
              {steps.map((step, i) => {
                const changed = diff?.added.includes(step.id)
                  ? 'added'
                  : diff?.updated.includes(step.id)
                    ? 'updated'
                    : null;
                const tools = toolsByStep.get(step.id) ?? 0;
                const dur = stepDuration(step);
                return (
                  <li key={step.id}>
                    <button
                      type="button"
                      onClick={() => {
                        selectStep(step.id);
                        setWorkbenchOpen(true);
                      }}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent/50',
                        stepStatusRing(step.status),
                        selectedStepId === step.id && 'ring-2 ring-ring/40',
                        changed === 'added' && 'bg-success/5 border-success/40',
                        changed === 'updated' && 'bg-warning/5 border-warning/40',
                      )}
                    >
                      <span className="mt-0.5 w-4 text-right font-mono text-xs text-muted-foreground">
                        {i + 1}
                      </span>
                      <StepStatusIcon status={step.status} className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-medium">{step.title}</span>
                          {changed === 'added' && <Badge variant="success">新增</Badge>}
                          {changed === 'updated' && <Badge variant="warning">修改</Badge>}
                          {step.attempt > 1 && (
                            <Badge variant="outline">第 {step.attempt} 次</Badge>
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {step.result?.summary ?? step.error ?? step.goal}
                        </span>
                        {step.dependsOn.length > 0 && (
                          <span className="block text-[11px] text-muted-foreground/70">
                            依赖：{step.dependsOn.join(', ')}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] text-muted-foreground">
                        <span>{stepStatusLabel[step.status]}</span>
                        <span>
                          {tools > 0 && `${tools} 工具`}
                          {tools > 0 && dur && ' · '}
                          {dur}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {diff && diff.removed.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground line-through">
                已移除：{diff.removed.join(', ')}
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
