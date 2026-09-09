import { AlertTriangle, ChevronRight, RotateCcw, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Spinner } from '@/components/ui/spinner';
import { deriveRunView } from '@/lib/run-view';
import type { AgentUIMessage } from '@/lib/types';
import { cn, formatDuration, formatTokens } from '@/lib/utils';
import { ApprovalCard } from './parts/approval-card';
import { ArtifactCard } from './parts/artifact-card';
import { CitationList } from './parts/citation-list';
import { FinalAnswer } from './parts/final-answer';
import { PlanCard } from './parts/plan-card';
import { PlanEditor } from './parts/plan-editor';
import { QuestionCard } from './parts/question-card';
import { StatusPill } from './parts/status-pill';
import { ToolCallCard } from './parts/tool-call-card';
import { UiWidgetCard } from './parts/ui-widget-card';

export interface AssistantMessageProps {
  message: AgentUIMessage;
  isLatest: boolean;
  isStreaming: boolean;
  /** Present only on the latest, settled message: re-runs its user input. */
  onRerun?: () => void;
  /** Latest settled message: clicking a UI widget starts the next turn. */
  onUiSubmit?: (text: string) => void;
}

export function AssistantMessage({
  message,
  isLatest,
  isStreaming,
  onRerun,
  onUiSubmit,
}: AssistantMessageProps) {
  const view = useMemo(() => deriveRunView(message), [message]);
  const live = isLatest && isStreaming && !view.isTerminal;
  const [toolsOpen, setToolsOpen] = useState(false);
  const awaitingPlan = live && view.status === 'awaiting_plan_confirmation' && !!view.plan;
  // Interaction cards stay clickable only while this run is live.
  const interactive = live && !!view.runId;
  const pendingApprovals = view.approvals.filter((a) => a.status === 'pending');
  const pendingQuestions = view.questions.filter((q) => q.answer === undefined);
  const resolvedApprovals = view.approvals.filter((a) => a.status !== 'pending');
  const answeredQuestions = view.questions.filter((q) => q.answer !== undefined);

  const duration =
    view.startedAt && (view.endedAt || live)
      ? formatDuration(
          (view.endedAt ? new Date(view.endedAt).getTime() : Date.now()) -
            new Date(view.startedAt).getTime(),
        )
      : null;

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-medium text-muted-foreground">
        助
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusPill status={view.status} reason={view.statusReason} />
          {view.status === 'planning' && <span>正在分析任务并制定计划…</span>}
          {view.status === 'executing' && !view.plan && <span>正在回复…</span>}
          {view.usage && view.usage.totalTokens > 0 && (
            <span title="Token 用量">{formatTokens(view.usage.totalTokens)} tokens</span>
          )}
          {duration && <span>{duration}</span>}
        </div>

        {!view.plan && live && view.status === 'planning' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> 正在整理步骤…
          </div>
        )}
        {!view.plan && live && view.status === 'executing' && !view.finalText && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> 正在回复…
          </div>
        )}

        {awaitingPlan && view.plan && view.runId ? (
          <PlanEditor
            key={`${view.runId}:${view.plan.revision}`}
            runId={view.runId}
            plan={view.plan}
          />
        ) : (
          view.plan && (
            <PlanCard
              plan={view.plan}
              steps={view.steps}
              toolCalls={view.toolCalls}
              diff={view.planDiff}
              reason={view.planReason}
              defaultOpen={isLatest}
            />
          )
        )}

        {(resolvedApprovals.length > 0 || answeredQuestions.length > 0) && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                已处理的交互 {resolvedApprovals.length + answeredQuestions.length} 项
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 grid gap-2">
                {resolvedApprovals.map((a) => (
                  <ApprovalCard key={a.id} approval={a} interactive={false} />
                ))}
                {answeredQuestions.map((q) => (
                  <QuestionCard key={q.id} question={q} interactive={false} />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {pendingApprovals.map((a) => (
          <ApprovalCard key={a.id} approval={a} interactive={interactive} />
        ))}
        {pendingQuestions.map((q) => (
          <QuestionCard key={q.id} question={q} interactive={interactive} />
        ))}

        {view.uiBlocks.length > 0 && (
          <div className="grid gap-2">
            {view.uiBlocks.map((block) => (
              <UiWidgetCard
                key={block.id}
                block={block}
                interactive={isLatest && !isStreaming && !!onUiSubmit}
                onPick={onUiSubmit}
              />
            ))}
          </div>
        )}

        {view.toolCalls.length > 0 && (
          <Collapsible open={toolsOpen || live} onOpenChange={setToolsOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    'size-3.5 transition-transform',
                    (toolsOpen || live) && 'rotate-90',
                  )}
                />
                <Wrench className="size-3.5" />
                工具调用 {view.toolCalls.length} 次
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 grid gap-1.5">
                {view.toolCalls.slice(live ? -5 : 0).map((t) => (
                  <ToolCallCard key={t.toolCallId} call={t} compact />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {(view.finalText || view.status === 'finalizing') && (
          <div className={view.plan ? 'rounded-md border bg-card px-4 py-3' : undefined}>
            {!view.finalText && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> 正在整理回答…
              </div>
            )}
            <FinalAnswer
              text={view.finalText}
              streaming={live && (view.status === 'finalizing' || view.status === 'executing')}
              actions={
                onRerun && view.status === 'succeeded' ? (
                  <Button type="button" variant="ghost" size="sm" onClick={onRerun}>
                    <RotateCcw />
                    重新生成
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}

        {view.citations.length > 0 && <CitationList citations={view.citations} />}
        {view.artifacts.length > 0 && (
          <div className="grid gap-1.5">
            <p className="text-xs text-muted-foreground">产物 {view.artifacts.length}</p>
            {view.artifacts.map((a) => (
              <ArtifactCard key={a.id} artifact={a} runId={view.runId} />
            ))}
          </div>
        )}

        {(view.status === 'failed' || view.status === 'cancelled') &&
          (view.error || view.statusReason) && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                {view.error ?? view.statusReason}
              </span>
              {onRerun && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={onRerun}
                >
                  <RotateCcw />
                  重试
                </Button>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
