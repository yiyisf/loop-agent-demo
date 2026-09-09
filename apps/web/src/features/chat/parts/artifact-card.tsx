import type { Artifact } from '@loop-agent/shared';
import { Download, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/utils';

export function ArtifactCard({ artifact, runId }: { artifact: Artifact; runId?: string }) {
  const href = runId ? api.artifactUrl(runId, artifact.id, true) : undefined;
  return (
    <div
      data-testid="artifact-card"
      className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{artifact.name}</p>
        <p className="text-xs text-muted-foreground">
          {artifact.mime}
          {artifact.size ? ` · ${formatBytes(artifact.size)}` : ''}
        </p>
      </div>
      {href ? (
        <a
          href={href}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <Download className="size-3.5" />
          下载
        </a>
      ) : null}
    </div>
  );
}
