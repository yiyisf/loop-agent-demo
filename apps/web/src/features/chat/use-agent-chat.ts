import { useChat } from '@ai-sdk/react';
import {
  type AttachmentDraft,
  dataPartIds,
  type LoopAgentDataParts,
  type RunStatus,
  TERMINAL_RUN_STATUSES,
} from '@loop-agent/shared';
import { useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport } from 'ai';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { queryKeys } from '@/lib/api';
import { deriveRunView } from '@/lib/run-view';
import type { AgentUIMessage } from '@/lib/types';
import { useRunStore } from '@/stores/run-store';
import type { ComposerSend } from './composer';

function attachmentPreview(draft: AttachmentDraft): LoopAgentDataParts['attachment'] {
  const raw = (draft.text ?? '').replace(/\s+/g, ' ').trim();
  return {
    name: draft.name,
    mime: draft.mime,
    size: draft.text ? new TextEncoder().encode(draft.text).length : 0,
    excerpt: raw
      ? raw.length > 280
        ? `${raw.slice(0, 280)}…`
        : raw
      : draft.dataBase64
        ? '（二进制附件）'
        : '',
  };
}

export interface UseAgentChatOptions {
  threadId: string;
  initialMessages: AgentUIMessage[];
}

const RECONNECT_DELAYS_MS = [800, 1500, 3000, 5000, 8000];

export function useAgentChat({ threadId, initialMessages }: UseAgentChatOptions) {
  const queryClient = useQueryClient();
  const appendStepLog = useRunStore((s) => s.appendStepLog);
  const clearStepLogs = useRunStore((s) => s.clearStepLogs);
  const pushNotice = useRunStore((s) => s.pushNotice);
  const model = useRunStore((s) => s.model);
  const autoApprove = useRunStore((s) => s.autoApprove);
  // useChat only reads the transport when the Chat instance is created, so the
  // composer settings are read through refs to stay current.
  const settings = useRef({ model, autoApprove });
  settings.current = { model, autoApprove };
  const pendingAttachments = useRef<AttachmentDraft[]>([]);

  const currentRunId = useRef<string | undefined>(undefined);
  const runStatus = useRef<RunStatus | undefined>(undefined);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnecting = useRef(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AgentUIMessage>({
        api: `/api/threads/${threadId}/messages`,
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            // Server persists history itself; only the latest user turn is needed.
            messages: messages.slice(-1),
            model: settings.current.model,
            toolPolicy: { autoApprove: settings.current.autoApprove },
            attachments: pendingAttachments.current,
            ...body,
          },
        }),
        // Resume always replays the whole run: the server stream re-sends the
        // assistant message with the same id, so useChat replaces the partial one.
        prepareReconnectToStreamRequest: () => ({
          api: `/api/runs/${currentRunId.current}/stream`,
        }),
        fetch: async (input, init) => {
          const res = await fetch(input, init);
          const runId = res.headers.get('x-run-id');
          if (runId) currentRunId.current = runId;
          return res;
        },
      }),
    [threadId],
  );

  const chat = useChat<AgentUIMessage>({
    id: threadId,
    messages: initialMessages,
    transport,
    onData: (part) => {
      if (part.type === 'data-step-log') {
        const d = part.data as LoopAgentDataParts['step-log'];
        const runId = currentRunId.current ?? 'current';
        appendStepLog(runId, d.stepId, d.kind, d.delta);
      } else if (part.type === 'data-notice') {
        const d = part.data as LoopAgentDataParts['notice'];
        pushNotice(d.level, d.message);
      } else if (part.type === 'data-run') {
        const d = part.data as LoopAgentDataParts['run'];
        currentRunId.current = d.runId;
        runStatus.current = d.status;
        if (reconnecting.current) {
          reconnecting.current = false;
          if (reconnectAttempt.current > 0) pushNotice('info', '连接已恢复');
          reconnectAttempt.current = 0;
        }
      }
    },
    onError: (err) => {
      const runId = currentRunId.current;
      const status = runStatus.current;
      const canResume = runId && (!status || !TERMINAL_RUN_STATUSES.has(status));
      if (canResume && reconnectAttempt.current < RECONNECT_DELAYS_MS.length) {
        const delay = RECONNECT_DELAYS_MS[reconnectAttempt.current]!;
        reconnectAttempt.current += 1;
        pushNotice('warn', `连接中断，${Math.round(delay / 1000)} 秒后重连…`);
        reconnectTimer.current = setTimeout(() => void resume(runId), delay);
        return;
      }
      reconnecting.current = false;
      pushNotice('error', err.message);
    },
    onFinish: () => {
      reconnecting.current = false;
      reconnectAttempt.current = 0;
      const invalidate = () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.thread(threadId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.threads });
      };
      invalidate();
      // The thread title is generated after the run finishes; pick it up shortly after.
      setTimeout(invalidate, 2000);
    },
  });

  const resume = useCallback(
    async (runId: string) => {
      currentRunId.current = runId;
      reconnecting.current = true;
      clearStepLogs(runId);
      try {
        await chat.resumeStream();
      } catch {
        // failures surface through onError, which schedules the next attempt
      }
    },
    [chat, clearStepLogs],
  );

  useEffect(
    () => () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    },
    [],
  );

  // Keep the last known run id in sync when history loads.
  useEffect(() => {
    const last = [...chat.messages].reverse().find((m) => m.role === 'assistant');
    if (last?.metadata?.runId && !currentRunId.current) currentRunId.current = last.metadata.runId;
  }, [chat.messages]);

  const lastAssistant = useMemo(
    () => [...chat.messages].reverse().find((m) => m.role === 'assistant'),
    [chat.messages],
  );
  const runView = useMemo(() => deriveRunView(lastAssistant), [lastAssistant]);
  const isBusy = chat.status === 'submitted' || chat.status === 'streaming';

  const send = useCallback(
    (input: string | ComposerSend) => {
      const payload = typeof input === 'string' ? { text: input, attachments: [] } : input;
      const attachments = payload.attachments ?? [];
      const trimmed =
        payload.text.trim() ||
        (attachments.length ? `请阅读附件：${attachments.map((f) => f.name).join('、')}` : '');
      if (!trimmed || isBusy) return;
      currentRunId.current = undefined;
      runStatus.current = undefined;
      reconnectAttempt.current = 0;
      pendingAttachments.current = attachments;
      void chat.sendMessage({
        parts: [
          { type: 'text', text: trimmed },
          ...attachments.map((f) => ({
            type: 'data-attachment' as const,
            id: dataPartIds.attachment(f.name),
            data: attachmentPreview(f),
          })),
        ],
      });
    },
    [chat, isBusy],
  );

  return {
    ...chat,
    send,
    resume,
    isBusy,
    runView,
    lastAssistant,
    currentRunId: runView.runId ?? currentRunId.current,
  };
}

export type AgentChat = ReturnType<typeof useAgentChat>;
