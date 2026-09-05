import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Artifact } from '@loop-agent/shared';
import { newId, nowIso } from '../lib/ids.js';

export interface ArtifactStoreOptions {
  onCreate?: (artifact: Artifact) => void | Promise<void>;
}

/** File-backed artifact store scoped to one run: data/runs/<runId>/artifacts. */
export class ArtifactStore {
  private items = new Map<string, Artifact>();

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

  async save(
    stepId: string,
    name: string,
    content: string | Uint8Array,
    mime: string,
  ): Promise<Artifact> {
    await mkdir(this.dir, { recursive: true });
    const id = newId('art');
    await writeFile(this.filePath(id), content);
    const size = typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength;
    const artifact: Artifact = {
      id,
      runId: this.runId,
      stepId,
      name,
      mime,
      size,
      createdAt: nowIso(),
    };
    this.items.set(id, artifact);
    await this.options.onCreate?.(artifact);
    return artifact;
  }

  get(id: string): Artifact | undefined {
    return this.items.get(id);
  }

  list(stepId?: string): Artifact[] {
    const all = [...this.items.values()];
    return stepId ? all.filter((a) => a.stepId === stepId) : all;
  }

  async readText(id: string, offset = 0, limit = 8000): Promise<{ text: string; total: number }> {
    if (!this.items.has(id)) throw new Error(`Unknown artifact "${id}"`);
    const buf = await readFile(this.filePath(id));
    const text = buf.toString('utf8');
    return { text: text.slice(offset, offset + limit), total: text.length };
  }

  async exists(id: string): Promise<boolean> {
    try {
      await stat(this.filePath(id));
      return true;
    } catch {
      return false;
    }
  }
}
