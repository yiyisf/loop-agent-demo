import type { Step, ToolCallRecord } from '@loop-agent/shared';
import { useQuery } from '@tanstack/react-query';
import { Brain, Download, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { StepStatusIcon } from '@/features/chat/parts/step-status-icon';
import { ToolCallCard } from '@/features/chat/parts/tool-call-card';
import { api, queryKeys } from '@/lib/api';
import { stepStatusLabel } from '@/lib/run-view';
import { formatBytes, formatDuration } from '@/lib/utils';
import type { StepLog } from '@/stores/run-store';

export function StepDetail({
  runId,
  step,
  toolCalls,
  log,
}: {
  runId: string | undefined;
  step: Step;
  toolCalls: ToolCallRecord[];
  log: StepLog | undefined;
}) {
  const artifactIds = step.result?.artifacts ?? [];
  const artifacts = useQuery({
    queryKey: queryKeys.runArtifacts(runId ?? ''),
    queryFn: () => api.getRunArtifacts(runId ?? ''),
    enabled: Boolean(runId) && artifactIds.length > 0,
    staleTime: 60_000,
  });
  const stepArtifacts = (artifacts.data ?? []).filter((a) => artifactIds.includes(a.id));
  const duration =
    step.startedAt &&
    formatDuration(
      (step.endedAt ? new Date(step.endedAt).getTime() : Date.now()) -
        new Date(step.startedAt).getTime(),
    );
  return (
    <div className="space-y-4 p-3 text-sm">
      <div>
        <div className="flex items-center gap-2">
          <StepStatusIcon status={step.status} />
          <h3 className="font-medium">{step.title}</h3>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
          <Badge variant="outline">{stepStatusLabel[step.status]}</Badge>
          <Badge variant="outline" className="font-mono">
            {step.id}
          </Badge>
          {step.attempt > 0 && <Badge variant="outline">尝试 {step.attempt}</Badge>}
          {duration && <Badge variant="outline">{duration}</Badge>}
          <Badge variant="outline">v{step.revisionIntroduced}</Badge>
        </div>
      </div>

      <Section title="目标">{step.goal}</Section>
      <Section title="验收标准">{step.acceptance}</Section>
      {step.dependsOn.length > 0 && <Section title="依赖">{step.dependsOn.join(', ')}</Section>}
      {step.tools.length > 0 && (
        <Section title="可用工具">
          <div className="flex flex-wrap gap-1">
            {step.tools.map((t) => (
              <Badge key={t} variant="secondary" className="font-mono">
                {t}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      {log?.reasoning && (
        <Section
          title={
            <span className="flex items-center gap-1">
              <Brain className="size-3.5" /> 思考
            </span>
          }
        >
          <p className="whitespace-pre-wrap text-xs text-muted-foreground italic">
            {log.reasoning}
          </p>
        </Section>
      )}
      {log?.text && (
        <Section title="过程输出">
          <p className="whitespace-pre-wrap text-xs">{log.text}</p>
        </Section>
      )}

      {toolCalls.length > 0 && (
        <Section title={`工具调用 (${toolCalls.length})`}>
          <div className="grid gap-1.5">
            {toolCalls.map((t) => (
              <ToolCallCard key={t.toolCallId} call={t} compact />
            ))}
          </div>
        </Section>
      )}

      {step.result && (
        <Section title="结果">
          <div className="rounded-md border bg-muted/40 p-2.5">
            <div className="mb-1 flex items-center gap-2">
              <Badge variant={step.result.status === 'succeeded' ? 'success' : 'destructive'}>
                {step.result.status === 'succeeded' ? '成功' : '失败'}
              </Badge>
              {step.result.artifacts.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {step.result.artifacts.length} 个产物
                </span>
              )}
            </div>
            <p className="whitespace-pre-wrap text-xs">{step.result.summary}</p>
          </div>
        </Section>
      )}
      {runId && stepArtifacts.length > 0 && (
        <Section title="产物">
          <ul className="grid gap-1">
            {stepArtifacts.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <a
                  href={api.artifactUrl(runId, a.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate font-mono hover:underline"
                  title={a.name}
                >
                  {a.name}
                </a>
                <span className="shrink-0 text-muted-foreground">{formatBytes(a.size)}</span>
                <a
                  href={api.artifactUrl(runId, a.id, true)}
                  aria-label={`下载 ${a.name}`}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <Download className="size-3.5" />
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {step.error && !step.result && (
        <Section title="错误">
          <p className="text-xs text-destructive">{step.error}</p>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}
