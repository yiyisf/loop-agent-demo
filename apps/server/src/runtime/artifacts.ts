import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Artifact } from '@loop-agent/shared';
import { newId, nowIso } from '../lib/ids.js';
import type { StoredArtifact } from '../store/types.js';

/** Where artifact metadata is persisted so it can be listed after a restart. */
export interface ArtifactPersistence {
  saveArtifact(artifact: StoredArtifact): Promise<void>;
  artifacts(runId: string): Promise<StoredArtifact[]>;
}

export interface ArtifactStoreOptions {
  persistence?: ArtifactPersistence;
  onCreate?: (artifact: Artifact) => void | Promise<void>;
}

/** File-backed artifact store scoped to one run: data/runs/<runId>/artifacts. */
export class ArtifactStore {
  private items = new Map<string, StoredArtifact>();
  private hydrated = false;

  constructor(
    readonly runId: string,
    readonly baseDir: string,
    private readonly options: ArtifactStoreOptions = {},
  ) {}

  get dir(): string {
    return path.join(this.baseDir, 'artifacts');
  }

  private filePath(id: string): string {
    return path.join(this.dir, id);
  }

  /** Loads persisted metadata (no-op without persistence or when already loaded). */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.options.persistence) return;
    for (const a of await this.options.persistence.artifacts(this.runId)) {
      if (!this.items.has(a.id)) this.items.set(a.id, a);
    }
  }

  async save(
    stepId: string,
    name: string,
    content: string | Uint8Array,
    mime: string,
  ): Promise<Artifact> {
    await mkdir(this.dir, { recursive: true });
    const id = newId('art');
    const file = this.filePath(id);
    await writeFile(file, content);
    const size = typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength;
    const artifact: StoredArtifact = {
      id,
      runId: this.runId,
      stepId,
      name,
      mime,
      size,
      createdAt: nowIso(),
      path: file,
    };
    this.items.set(id, artifact);
    await this.options.persistence?.saveArtifact(artifact);
    await this.options.onCreate?.(toArtifact(artifact));
    return toArtifact(artifact);
  }

  get(id: string): Artifact | undefined {
    const a = this.items.get(id);
    return a ? toArtifact(a) : undefined;
  }

  list(stepId?: string): Artifact[] {
    const all = [...this.items.values()].map(toArtifact);
    return stepId ? all.filter((a) => a.stepId === stepId) : all;
  }

  async readText(id: string, offset = 0, limit = 8000): Promise<{ text: string; total: number }> {
    const meta = this.items.get(id);
    if (!meta) throw new Error(`Unknown artifact "${id}"`);
    const buf = await readFile(meta.path);
    const text = buf.toString('utf8');
    return { text: text.slice(offset, offset + limit), total: text.length };
  }

  async readBytes(id: string): Promise<Buffer> {
    const meta = this.items.get(id);
    if (!meta) throw new Error(`Unknown artifact "${id}"`);
    return readFile(meta.path);
  }

  async exists(id: string): Promise<boolean> {
    const meta = this.items.get(id);
    if (!meta) return false;
    try {
      await stat(meta.path);
      return true;
    } catch {
      return false;
    }
  }
}

function toArtifact(a: StoredArtifact): Artifact {
  const { path: _path, ...rest } = a;
  return rest;
}
