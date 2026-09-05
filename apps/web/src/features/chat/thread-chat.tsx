import { useEffect, useRef } from 'react';
import { TopBar } from '@/components/layout/top-bar';
import { api } from '@/lib/api';
import type { ThreadDetail } from '@/lib/types';
import { useRunStore } from '@/stores/run-store';
import { useWorkbenchStore } from '@/stores/workbench-store';
import { Composer } from './composer';
import { MessageList } from './message-list';
import { NoticeStack } from './notice-stack';
import { StatusPill } from './parts/status-pill';
import { useAgentChat } from './use-agent-chat';

export function ThreadChat({ threadId, detail }: { threadId: string; detail: ThreadDetail }) {
  const chat = useAgentChat({ threadId, initialMessages: detail.messages });
  const pending = useRunStore((s) => s.pendingMessage);
  const setPendingMessage = useRunStore((s) => s.setPendingMessage);
  const setActive = useWorkbenchStore((s) => s.setActive);
  const sentPending = useRef(false);

  useEffect(() => {
    if (pending && pending.threadId === threadId && !sentPending.current) {
      sentPending.current = true;
      setPendingMessage(null);
      chat.send(pending.text);
    }
  }, [pending, threadId, chat, setPendingMessage]);

  useEffect(() => {
    setActive(threadId, chat.runView);
  }, [threadId, chat.runView, setActive]);

  useEffect(() => () => setActive(null, null), [setActive]);

  const stop = async () => {
    const runId = chat.currentRunId;
    if (runId) {
      try {
        await api.cancelRun(runId);
      } catch {
        // run may already be finished
      }
    }
    await chat.stop();
  };

  return (
    <>
      <TopBar title={detail.thread.title || '会话'}>
        {chat.isBusy && <StatusPill status={chat.runView.status ?? 'queued'} />}
      </TopBar>
      <MessageList messages={chat.messages} isStreaming={chat.isBusy} />
      <div className="shrink-0 px-4 pb-4">
        <div className="mx-auto w-full max-w-3xl">
          <NoticeStack />
          <Composer
            onSend={chat.send}
            onStop={stop}
            busy={chat.isBusy}
            placeholder={chat.isBusy ? '运行中…' : '继续提问或下达新任务'}
          />
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            Agent 可能出错，请核实关键结论。
          </p>
        </div>
      </div>
    </>
  );
}
