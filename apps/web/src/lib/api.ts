import type { PlanConfirmation, RunEvent } from '@loop-agent/shared';
import type { ModelsInfo, RunSnapshot, ThreadDetail, ThreadListItem, ToolInfo } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listThreads: () => request<{ threads: ThreadListItem[] }>('/api/threads').then((r) => r.threads),
  createThread: (title?: string) =>
    request<{ thread: ThreadListItem }>('/api/threads', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }).then((r) => r.thread),
  getThread: (id: string) => request<ThreadDetail>(`/api/threads/${id}`),
  deleteThread: (id: string) => request<void>(`/api/threads/${id}`, { method: 'DELETE' }),
  renameThread: (id: string, title: string) =>
    request<{ thread: ThreadListItem }>(`/api/threads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }).then((r) => r.thread),
  getRun: (id: string) => request<RunSnapshot>(`/api/runs/${id}`),
  getRunEvents: (id: string, limit = 500) =>
    request<{ events: RunEvent[]; active: boolean }>(`/api/runs/${id}/events?limit=${limit}`),
  cancelRun: (id: string) => request<{ ok: boolean }>(`/api/runs/${id}/cancel`, { method: 'POST' }),
  respondApproval: (runId: string, approvalId: string, approved: boolean, reason?: string) =>
    request<{ ok: boolean }>(`/api/runs/${runId}/approvals/${approvalId}`, {
      method: 'POST',
      body: JSON.stringify({ approved, reason: reason?.trim() || undefined }),
    }),
  answerQuestion: (runId: string, questionId: string, answer: string) =>
    request<{ ok: boolean }>(`/api/runs/${runId}/questions/${questionId}`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    }),
  confirmPlan: (runId: string, decision: PlanConfirmation) =>
    request<{ ok: boolean }>(`/api/runs/${runId}/plan/confirm`, {
      method: 'POST',
      body: JSON.stringify(decision),
    }),
  listTools: () => request<{ tools: ToolInfo[] }>('/api/tools').then((r) => r.tools),
  models: () => request<ModelsInfo>('/api/models'),
};

export const queryKeys = {
  threads: ['threads'] as const,
  thread: (id: string) => ['threads', id] as const,
  run: (id: string) => ['runs', id] as const,
  runEvents: (id: string) => ['runs', id, 'events'] as const,
  tools: ['tools'] as const,
  models: ['models'] as const,
};
