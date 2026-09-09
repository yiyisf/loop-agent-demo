import type { Artifact } from '@loop-agent/shared';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Markdown } from '@/features/chat/parts/final-answer';
import { JsonView } from '@/features/chat/parts/json-view';
import { api } from '@/lib/api';
import { artifactKindLabel, artifactPreviewKind, parseCsvPreview } from '@/lib/artifact-kind';
import { formatBytes } from '@/lib/utils';

const TEXT_PREVIEW_MAX = 200_000;

function isTextKind(kind: ReturnType<typeof artifactPreviewKind>): boolean {
  return kind === 'markdown' || kind === 'json' || kind === 'csv' || kind === 'text';
}

export function ArtifactPreview({ runId, artifact }: { runId: string; artifact: Artifact }) {
  const kind = artifactPreviewKind(artifact.name, artifact.mime);
  const url = api.artifactUrl(runId, artifact.id);
  const downloadUrl = api.artifactUrl(runId, artifact.id, true);
  const tooLarge = artifact.size > TEXT_PREVIEW_MAX;
  const textQuery = useQuery({
    queryKey: ['artifact-text', runId, artifact.id],
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('无法读取产物');
      return res.text();
    },
    enabled: isTextKind(kind) && !tooLarge,
    staleTime: 60_000,
  });

  return (
    <div data-testid="artifact-preview" className="space-y-2">
      <div className="flex items-start gap-2 text-xs">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{artifact.name}</p>
          <p className="text-muted-foreground">
            {artifactKindLabel[kind]}
            {artifact.size ? ` · ${formatBytes(artifact.size)}` : ''}
          </p>
        </div>
        <a
          href={downloadUrl}
          className="inline-flex shrink-0 items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <Download className="size-3.5" />
          下载
        </a>
      </div>
      <PreviewBody
        kind={kind}
        url={url}
        tooLarge={tooLarge}
        text={textQuery.data}
        loading={textQuery.isLoading}
        error={textQuery.error instanceof Error ? textQuery.error.message : undefined}
      />
    </div>
  );
}

function PreviewBody({
  kind,
  url,
  tooLarge,
  text,
  loading,
  error,
}: {
  kind: ReturnType<typeof artifactPreviewKind>;
  url: string;
  tooLarge: boolean;
  text?: string;
  loading: boolean;
  error?: string;
}) {
  if (kind === 'image') {
    return (
      <img
        src={url}
        alt="产物预览"
        className="max-h-72 w-full rounded-md border object-contain bg-muted/40"
      />
    );
  }
  if (kind === 'pdf') {
    return <iframe title="PDF 预览" src={url} className="h-72 w-full rounded-md border bg-card" />;
  }
  if (kind === 'binary') {
    return <p className="text-xs text-muted-foreground">此类型无法在工作台预览，请下载查看。</p>;
  }
  if (tooLarge) {
    return <p className="text-xs text-muted-foreground">文件较大，请下载后查看完整内容。</p>;
  }
  if (loading) return <p className="text-xs text-muted-foreground">正在加载预览…</p>;
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (text === undefined) return null;

  if (kind === 'markdown') {
    return (
      <div className="rounded-md border bg-card px-3 py-2">
        <Markdown text={text} />
      </div>
    );
  }
  if (kind === 'json') {
    let value: unknown = text;
    try {
      value = JSON.parse(text);
    } catch {
      // keep raw text
    }
    return <JsonView value={value} maxHeight="max-h-72" />;
  }
  if (kind === 'csv') {
    const rows = parseCsvPreview(text);
    if (rows.length === 0) return <p className="text-xs text-muted-foreground">CSV 为空</p>;
    const [header, ...body] = rows;
    return (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              {header?.map((cell) => (
                <th key={cell} className="px-2 py-1 font-medium">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row) => (
              <tr key={row.join('|')} className="border-b last:border-0">
                {row.map((cell, i) => (
                  <td key={`${header?.[i] ?? i}:${cell}`} className="px-2 py-1">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}
