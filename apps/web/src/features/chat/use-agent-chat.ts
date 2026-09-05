import { useChat } from '@ai-sdk/react';
import type { LoopAgentDataParts } from '@loop-agent/shared';
import { useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport } from 'ai';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { queryKeys } from '@/lib/api';
import { deriveRunView } from '@/lib/run-view';
import type { AgentUIMessage } from '@/lib/types';
import { useRunStore } from '@/stores/run-store';

export interface UseAgentChatOptions {
  threadId: string;
  initialMessages: AgentUIMessage[];
}

export function useAgentChat({ threadId, initialMessages }: UseAgentChatOptions) {
  const queryClient = useQueryClient();
  const appendStepLog = useRunStore((s) => s.appendStepLog);
  const pushNotice = useRunStore((s) => s.pushNotice);
  const mode = useRunStore((s) => s.mode);
  const model = useRunStore((s) => s.model);
  const currentRunId = useRef<string | undefined>(undefined);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AgentUIMessage>({
        api: `/api/threads/${threadId}/messages`,
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            // Server persists history itself; only the latest user turn is needed.
            messages: messages.slice(-1),
            mode,
            model,
            ...body,
          },
        }),
        fetch: async (input, init) => {
          const res = await fetch(input, init);
          currentRunId.current = res.headers.get('x-run-id') ?? undefined;
          return res;
        },
      }),
    [threadId, mode, model],
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
      }
    },
    onError: (err) => pushNotice('error', err.message),
    onFinish: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.thread(threadId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.threads });
    },
  });

  // Keep the last known run id in sync when history loads.
  useEffect(() => {
    const last = [...chat.messages].reverse().find((m) => m.role === 'assistant');
    if (last?.metadata?.runId) currentRunId.current = last.metadata.runId;
  }, [chat.messages]);

  const lastAssistant = useMemo(
    () => [...chat.messages].reverse().find((m) => m.role === 'assistant'),
    [chat.messages],
  );
  const runView = useMemo(() => deriveRunView(lastAssistant), [lastAssistant]);
  const isBusy = chat.status === 'submitted' || chat.status === 'streaming';

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isBusy) return;
      void chat.sendMessage({ text: trimmed });
    },
    [chat, isBusy],
  );

  return {
    ...chat,
    send,
    isBusy,
    runView,
    lastAssistant,
    currentRunId: runView.runId ?? currentRunId.current,
  };
}

export type AgentChat = ReturnType<typeof useAgentChat>;
