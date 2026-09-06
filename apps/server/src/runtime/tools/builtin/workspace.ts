import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolDefinition, ToolRuntime } from '../types.js';

const MAX_READ = 20_000;

/** Resolves a relative path inside the run workspace, rejecting traversal. */
export function resolveInWorkspace(workspaceDir: string, relative: string): string {
  const normalized = path.normalize(relative).replace(/^([/\\])+/, '');
  const abs = path.resolve(workspaceDir, normalized);
  const root = path.resolve(workspaceDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`Path "${relative}" escapes the workspace`);
  }
  return abs;
}

const mimeFor = (file: string): string => {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.csv': 'text/csv',
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.ts': 'text/typescript',
      '.py': 'text/x-python',
    }[ext] ?? 'text/plain'
  );
};

export const workspaceWriteTool: ToolDefinition = {
  name: 'workspace_write',
  description:
    'Write a text file into the run workspace (creates or overwrites). The file is registered as an artifact that later steps can read.',
  risk: 'low',
  category: 'fs',
  plannable: true,
  create: (rt: ToolRuntime) =>
    tool({
      description:
        'Write text content to a file in the workspace, e.g. "notes/findings.md". Returns the artifact id.',
      inputSchema: z.object({
        path: z.string().min(1).max(200),
        content: z.string().max(200_000),
      }),
      execute: async ({ path: rel, content }) => {
        try {
          const abs = resolveInWorkspace(rt.workspaceDir, rel);
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, content, 'utf8');
          const artifact = await rt.artifacts.save(rt.stepId, rel, content, mimeFor(rel));
          return { path: rel, bytes: Buffer.byteLength(content), artifactId: artifact.id };
        } catch (err) {
          return { path: rel, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
};

export const workspaceReadTool: ToolDefinition = {
  name: 'workspace_read',
  description: 'Read a text file from the run workspace.',
  risk: 'low',
  category: 'fs',
  plannable: true,
  create: (rt: ToolRuntime) =>
    tool({
      description:
        'Read a workspace file. Large files are returned in windows; use offset to page.',
      inputSchema: z.object({
        path: z.string().min(1).max(200),
        offset: z.number().int().nonnegative().default(0),
      }),
      execute: async ({ path: rel, offset }) => {
        try {
          const abs = resolveInWorkspace(rt.workspaceDir, rel);
          const text = await readFile(abs, 'utf8');
          return {
            path: rel,
            total: text.length,
            offset,
            content: text.slice(offset, offset + MAX_READ),
            truncated: text.length > offset + MAX_READ,
          };
        } catch (err) {
          return { path: rel, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
};

export const workspaceListTool: ToolDefinition = {
  name: 'workspace_list',
  description: 'List files in the run workspace.',
  risk: 'low',
  category: 'fs',
  plannable: true,
  create: (rt: ToolRuntime) =>
    tool({
      description: 'List files (recursively) under a workspace directory.',
      inputSchema: z.object({ path: z.string().default('.') }),
      execute: async ({ path: rel }) => {
        try {
          const abs = resolveInWorkspace(rt.workspaceDir, rel);
          const files: Array<{ path: string; bytes: number }> = [];
          const walk = async (dir: string) => {
            let entries: import('node:fs').Dirent[] = [];
            try {
              entries = await readdir(dir, { withFileTypes: true });
            } catch {
              return;
            }
            for (const e of entries) {
              const full = path.join(dir, e.name);
              if (e.isDirectory()) await walk(full);
              else {
                const s = await stat(full);
                files.push({ path: path.relative(rt.workspaceDir, full), bytes: s.size });
              }
              if (files.length >= 200) return;
            }
          };
          await walk(abs);
          return { files };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
};

export const readArtifactTool: ToolDefinition = {
  name: 'read_artifact',
  description: 'Read the content of an artifact produced by a previous step, by artifact id.',
  risk: 'low',
  category: 'fs',
  plannable: true,
  create: (rt: ToolRuntime) =>
    tool({
      description:
        'Read an artifact by id (paged with offset). Use ids listed in earlier step results.',
      inputSchema: z.object({
        artifactId: z.string(),
        offset: z.number().int().nonnegative().default(0),
      }),
      execute: async ({ artifactId, offset }) => {
        try {
          const meta = rt.artifacts.get(artifactId);
          if (!meta) return { artifactId, error: 'Unknown artifact id' };
          const { text, total } = await rt.artifacts.readText(artifactId, offset, MAX_READ);
          return { artifactId, name: meta.name, mime: meta.mime, total, offset, content: text };
        } catch (err) {
          return { artifactId, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
};
