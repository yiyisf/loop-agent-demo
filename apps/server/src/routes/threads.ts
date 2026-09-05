import {
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

/** Compact conversation history handed to the planner for follow-up turns. */
export function buildHistory(messages: LoopAgentUIMessage[], maxChars = 4000): string | undefined {
  const lines: string[] = [];
  for (const m of messages) {
    const text = messageText(m);
    if (!text) continue;
    lines.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${text.slice(0, 1500)}`);
  }
  if (lines.length === 0) return undefined;
  const joined = lines.join('\n\n');
  return joined.length > maxChars ? joined.slice(joined.length - maxChars) : joined;
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
    const text = extractUserText(parsed.data);
    if (!text) throw new HTTPException(400, { message: 'Message text is required' });

    if (runManager.activeRunForThread(threadId)) {
      throw new HTTPException(409, { message: 'A run is already active in this thread' });
    }

    const previous = await stores.threads.messages(threadId);
    const userMessage: LoopAgentUIMessage = {
      id: newId('msg'),
      role: 'user',
      metadata: { threadId, createdAt: nowIso() },
      parts: [{ type: 'text', text }],
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
    });

    return createUIMessageStreamResponse({
      stream: createRunUIStream({ bus, run, signal: c.req.raw.signal }),
      headers: { [RUN_ID_HEADER]: run.id, [THREAD_ID_HEADER]: threadId },
    });
  });

  return router;
}
