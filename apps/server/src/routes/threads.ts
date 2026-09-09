import {
  dataPartIds,
  RUN_ID_HEADER,
  type RunMode,
  SendMessageRequestSchema,
  THREAD_ID_HEADER,
  UpdateThreadRequestSchema,
} from '@loop-agent/shared';
import { createUIMessageStreamResponse } from 'ai';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../app.js';
import { newId, nowIso } from '../lib/ids.js';
import {
  AttachmentError,
  extractAttachments,
  toAttachmentPreview,
} from '../runtime/attachments.js';
import { fallbackTitle } from '../runtime/title.js';
import { createRunUIStream, type LoopAgentUIMessage } from '../runtime/ui-stream.js';

interface UserMessageLike {
  role?: string;
  parts?: Array<{ type?: string; text?: string }>;
}

function extractUserText(body: { text?: string; messages?: unknown[] }): string {
  if (body.text?.trim()) return body.text.trim();
  const messages = (body.messages ?? []) as UserMessageLike[];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    const text = (m.parts ?? [])
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

function messageText(m: LoopAgentUIMessage): string {
  return m.parts
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();
}

function assistantHistoryLine(m: LoopAgentUIMessage): string | undefined {
  const bits: string[] = [];
  for (const part of m.parts) {
    if (part.type === 'data-plan') {
      const plan = (part.data as { plan?: { objective?: string } })?.plan;
      if (plan?.objective) bits.push(`[plan] ${plan.objective}`);
    }
    if (part.type === 'data-tool') {
      const tool = part.data as { toolName?: string };
      if (tool.toolName) bits.push(`[tool] ${tool.toolName}`);
    }
  }
  const text = messageText(m);
  if (text) bits.push(text.slice(0, 800));
  if (bits.length === 0) return undefined;
  return `Assistant: ${bits.join(' | ')}`;
}

/** Recent turns for the router / planner. Keeps plan and tool names, not a raw dump. */
export function buildHistory(messages: LoopAgentUIMessage[], maxTurns = 10): string | undefined {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const text = messageText(m);
      const files = m.parts
        .filter((p) => p.type === 'data-attachment')
        .map((p) => (p.data as { name?: string }).name)
        .filter((n): n is string => !!n);
      const bits = [
        text ? text.slice(0, 800) : '',
        files.length ? `[file] ${files.join(', ')}` : '',
      ].filter(Boolean);
      if (bits.length) lines.push(`User: ${bits.join(' | ')}`);
      continue;
    }
    if (m.role === 'assistant') {
      const line = assistantHistoryLine(m);
      if (line) lines.push(line);
    }
  }
  const recent = lines.slice(-maxTurns);
  return recent.length > 0 ? recent.join('\n') : undefined;
}

export function threadRoutes(ctx: AppContext) {
  const router = new Hono();
  const { stores, runManager, bus } = ctx;

  router.get('/', async (c) => {
    const threads = await stores.threads.list();
    return c.json({
      threads: threads.map((t) => ({
        ...t,
        activeRunId: runManager.activeRunForThread(t.id)?.id ?? null,
      })),
    });
  });

  router.post('/', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { title?: string };
    const thread = await stores.threads.create(body.title);
    return c.json({ thread }, 201);
  });

  router.get('/:id', async (c) => {
    const thread = await stores.threads.get(c.req.param('id'));
    if (!thread) throw new HTTPException(404, { message: 'Thread not found' });
    const [messages, runs] = await Promise.all([
      stores.threads.messages(thread.id),
      stores.runs.listByThread(thread.id),
    ]);
    const activeRun = runManager.activeRunForThread(thread.id);
    return c.json({
      thread: { ...thread, activeRunId: activeRun?.id ?? null },
      messages,
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,
        endedAt: r.endedAt,
      })),
    });
  });

  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const thread = await stores.threads.get(id);
    if (!thread) throw new HTTPException(404, { message: 'Thread not found' });
    const parsed = UpdateThreadRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(400, { message: 'Invalid request body' });
    await stores.threads.updateTitle(id, parsed.data.title.trim());
    return c.json({ thread: await stores.threads.get(id) });
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const active = runManager.activeRunForThread(id);
    if (active) runManager.cancel(active.id, 'thread deleted');
    const ok = await stores.threads.delete(id);
    if (!ok) throw new HTTPException(404, { message: 'Thread not found' });
    return c.body(null, 204);
  });

  router.post('/:id/messages', async (c) => {
    const threadId = c.req.param('id');
    const thread = await stores.threads.get(threadId);
    if (!thread) throw new HTTPException(404, { message: 'Thread not found' });

    const parsed = SendMessageRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(400, { message: 'Invalid request body' });

    let attachments: ReturnType<typeof extractAttachments> = [];
    try {
      attachments = extractAttachments(parsed.data.attachments);
    } catch (err) {
      if (err instanceof AttachmentError) {
        throw new HTTPException(400, { message: err.message });
      }
      throw err;
    }

    let text = extractUserText(parsed.data);
    if (!text && attachments.length) {
      text = `请阅读附件：${attachments.map((f) => f.name).join('、')}`;
    }
    if (!text) throw new HTTPException(400, { message: 'Message text is required' });

    if (runManager.activeRunForThread(threadId)) {
      throw new HTTPException(409, { message: 'A run is already active in this thread' });
    }

    const previous = await stores.threads.messages(threadId);
    const userMessage: LoopAgentUIMessage = {
      id: newId('msg'),
      role: 'user',
      metadata: { threadId, createdAt: nowIso() },
      parts: [
        { type: 'text', text },
        ...attachments.map((f) => ({
          type: 'data-attachment' as const,
          id: dataPartIds.attachment(f.name),
          data: toAttachmentPreview(f),
        })),
      ],
    };
    await stores.threads.appendMessage(threadId, userMessage);
    if (previous.length === 0) {
      await stores.threads.updateTitle(threadId, fallbackTitle(text));
    }

    const run = await runManager.start({
      threadId,
      input: text,
      mode: (parsed.data.mode ?? 'auto') as RunMode,
      model: parsed.data.model,
      autoApprove: parsed.data.toolPolicy?.autoApprove ?? false,
      history: buildHistory(previous),
      attachments,
    });

    return createUIMessageStreamResponse({
      stream: createRunUIStream({ bus, run, signal: c.req.raw.signal }),
      headers: { [RUN_ID_HEADER]: run.id, [THREAD_ID_HEADER]: threadId },
    });
  });

  return router;
}
