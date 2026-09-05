import { Activity, ListTree, PanelRightClose } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StepStatusIcon } from '@/features/chat/parts/step-status-icon';
import { runStatusLabel } from '@/lib/run-view';
import { cn, formatDuration, formatTokens } from '@/lib/utils';
import { useRunStore } from '@/stores/run-store';
import { useUiStore } from '@/stores/ui-store';
import { useWorkbenchStore } from '@/stores/workbench-store';
import { StepDetail } from './step-detail';

export function WorkbenchPanel() {
  const setWorkbenchOpen = useUiStore((s) => s.setWorkbenchOpen);
  const selectedStepId = useUiStore((s) => s.selectedStepId);
  const selectStep = useUiStore((s) => s.selectStep);
  const view = useWorkbenchStore((s) => s.runView);
  const stepLogs = useRunStore((s) => (view?.runId ? s.stepLogs[view.runId] : undefined));

  const selected = useMemo(() => {
    if (!view) return undefined;
    return (
      view.steps.find((s) => s.id === selectedStepId) ??
      view.steps.find((s) => s.status === 'running')
    );
  }, [view, selectedStepId]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
        <span className="text-sm font-medium">工作台</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="收起工作台"
          onClick={() => setWorkbenchOpen(false)}
        >
          <PanelRightClose />
        </Button>
      </div>

      {!view?.plan ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          运行开始后，这里会显示步骤详情、工具调用与用量。
        </div>
      ) : (
        <Tabs defaultValue="steps" className="min-h-0 flex-1 gap-0">
          <div className="border-b px-3 py-2">
            <TabsList className="w-full">
              <TabsTrigger value="steps">
                <ListTree /> 步骤
              </TabsTrigger>
              <TabsTrigger value="run">
                <Activity /> 运行
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="steps" className="min-h-0 overflow-y-auto scrollbar-thin">
            <div className="flex flex-wrap gap-1 border-b p-2">
              {view.steps.map((s, i) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => selectStep(s.id)}
                  title={s.title}
                  className={cn(
                    'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs hover:bg-accent',
                    selected?.id === s.id && 'border-primary bg-primary/10',
                  )}
                >
                  <StepStatusIcon status={s.status} className="size-3" />
                  {i + 1}
                </button>
              ))}
            </div>
            {selected ? (
              <StepDetail
                step={selected}
                toolCalls={view.toolCalls.filter((t) => t.stepId === selected.id)}
                log={stepLogs?.[selected.id]}
              />
            ) : (
              <p className="p-4 text-center text-sm text-muted-foreground">选择一个步骤查看详情</p>
            )}
          </TabsContent>

          <TabsContent value="run" className="min-h-0 overflow-y-auto p-3 text-sm scrollbar-thin">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">状态</dt>
              <dd>{view.status ? runStatusLabel[view.status] : '-'}</dd>
              <dt className="text-muted-foreground">Run ID</dt>
              <dd className="truncate font-mono text-xs">{view.runId}</dd>
              <dt className="text-muted-foreground">计划版本</dt>
              <dd>v{view.plan.revision}</dd>
              <dt className="text-muted-foreground">步骤</dt>
              <dd>
                {view.steps.filter((s) => s.status === 'succeeded').length}/{view.steps.length} 完成
              </dd>
              <dt className="text-muted-foreground">耗时</dt>
              <dd>
                {view.startedAt
                  ? formatDuration(
                      (view.endedAt ? new Date(view.endedAt).getTime() : Date.now()) -
                        new Date(view.startedAt).getTime(),
                    )
                  : '-'}
              </dd>
              {view.usage && (
                <>
                  <dt className="text-muted-foreground">Tokens</dt>
                  <dd>
                    {formatTokens(view.usage.totalTokens)}
                    <span className="text-muted-foreground">
                      {' '}
                      (入 {formatTokens(view.usage.inputTokens)} / 出{' '}
                      {formatTokens(view.usage.outputTokens)})
                    </span>
                  </dd>
                  <dt className="text-muted-foreground">LLM 调用</dt>
                  <dd>{view.usage.llmCalls}</dd>
                  <dt className="text-muted-foreground">工具调用</dt>
                  <dd>{view.usage.toolCalls}</dd>
                </>
              )}
              {view.error && (
                <>
                  <dt className="text-muted-foreground">错误</dt>
                  <dd className="text-destructive">{view.error}</dd>
                </>
              )}
            </dl>
            {view.plan.rationale && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-medium text-muted-foreground">规划思路</p>
                <p className="text-xs">{view.plan.rationale}</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
