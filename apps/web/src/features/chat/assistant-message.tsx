import { AlertTriangle, Bot, ChevronRight, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Spinner } from '@/components/ui/spinner';
import { deriveRunView } from '@/lib/run-view';
import type { AgentUIMessage } from '@/lib/types';
import { cn, formatDuration, formatTokens } from '@/lib/utils';
import { FinalAnswer } from './parts/final-answer';
import { PlanCard } from './parts/plan-card';
import { StatusPill } from './parts/status-pill';
import { ToolCallCard } from './parts/tool-call-card';

export interface AssistantMessageProps {
  message: AgentUIMessage;
  isLatest: boolean;
  isStreaming: boolean;
}

export function AssistantMessage({ message, isLatest, isStreaming }: AssistantMessageProps) {
  const view = useMemo(() => deriveRunView(message), [message]);
  const live = isLatest && isStreaming && !view.isTerminal;
  const [toolsOpen, setToolsOpen] = useState(false);

  const duration =
    view.startedAt && (view.endedAt || live)
      ? formatDuration(
          (view.endedAt ? new Date(view.endedAt).getTime() : Date.now()) -
            new Date(view.startedAt).getTime(),
        )
      : null;

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Bot className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusPill status={view.status} reason={view.statusReason} />
          {view.status === 'planning' && <span>正在分析任务并制定计划…</span>}
          {view.usage && view.usage.totalTokens > 0 && (
            <span title="Token 用量">{formatTokens(view.usage.totalTokens)} tokens</span>
          )}
          {duration && <span>{duration}</span>}
        </div>

        {!view.plan && live && (
          <div className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">
            <Spinner /> 规划中，请稍候…
          </div>
        )}

        {view.plan && (
          <PlanCard
            plan={view.plan}
            steps={view.steps}
            toolCalls={view.toolCalls}
            diff={view.planDiff}
            reason={view.planReason}
            defaultOpen={isLatest}
          />
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
          <div className="rounded-xl border bg-card px-4 py-3">
            {!view.finalText && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> 正在整理最终回答…
              </div>
            )}
            <FinalAnswer text={view.finalText} streaming={live && view.status === 'finalizing'} />
          </div>
        )}

        {(view.status === 'failed' || view.status === 'cancelled') &&
          (view.error || view.statusReason) && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{view.error ?? view.statusReason}</span>
            </div>
          )}
      </div>
    </div>
  );
}
