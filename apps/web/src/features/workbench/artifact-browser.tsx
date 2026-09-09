import type { Artifact } from '@loop-agent/shared';
import { useState } from 'react';
import { artifactKindLabel, artifactPreviewKind } from '@/lib/artifact-kind';
import { cn } from '@/lib/utils';
import { ArtifactPreview } from './artifact-preview';

export function ArtifactBrowser({ runId, artifacts }: { runId: string; artifacts: Artifact[] }) {
  const [selectedId, setSelectedId] = useState(artifacts[0]?.id);
  const selected = artifacts.find((a) => a.id === selectedId) ?? artifacts[0];

  if (artifacts.length === 0) {
    return <p className="p-4 text-center text-sm text-muted-foreground">暂无产物</p>;
  }

  return (
    <div data-testid="workbench-artifacts" className="space-y-3 p-3">
      <ul className="grid gap-1">
        {artifacts.map((a) => {
          const kind = artifactPreviewKind(a.name, a.mime);
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setSelectedId(a.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-accent/60',
                  selected?.id === a.id && 'border-foreground/30 bg-accent/40',
                )}
              >
                <span className="min-w-0 truncate font-medium">{a.name}</span>
                <span className="shrink-0 text-muted-foreground">{artifactKindLabel[kind]}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {selected ? <ArtifactPreview runId={runId} artifact={selected} /> : null}
    </div>
  );
}
