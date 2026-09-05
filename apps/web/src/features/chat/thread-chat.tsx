import { TERMINAL_RUN_STATUSES } from '@loop-agent/shared';
import { Hand } from 'lucide-react';
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
  const resumedRun = useRef<string | null>(null);

  useEffect(() => {
    if (pending && pending.threadId === threadId && !sentPending.current) {
      sentPending.current = true;
      setPendingMessage(null);
      chat.send(pending.text);
    }
  }, [pending, threadId, chat, setPendingMessage]);

  // Coming back to a thread whose run is still in flight (refresh, navigation):
  // re-attach to the server-side stream and replay what happened so far.
  const activeRunId = detail.thread.activeRunId;
  const viewedRunId = chat.runView.runId;
  const viewedStatus = chat.runView.status;
  useEffect(() => {
    if (!activeRunId || chat.isBusy || resumedRun.current === activeRunId) return;
    if (pending?.threadId === threadId) return;
    // Thread query may lag behind a run we already watched to completion.
    if (viewedRunId === activeRunId && viewedStatus && TERMINAL_RUN_STATUSES.has(viewedStatus))
      return;
    resumedRun.current = activeRunId;
    void chat.resume(activeRunId);
  }, [activeRunId, chat, pending, threadId, viewedRunId, viewedStatus]);

  useEffect(() => {
    setActive(threadId, chat.runView);
  }, [threadId, chat.runView, setActive]);

  useEffect(() => () => setActive(null, null), [setActive]);

  const waitingHint = (() => {
    switch (chat.runView.status) {
      case 'awaiting_plan_confirmation':
        return 'Agent 已生成计划，等待你确认后开始执行';
      case 'awaiting_approval':
        return '有工具调用等待你的审批';
      case 'awaiting_user':
        return 'Agent 向你提了一个问题，回答后继续';
      default:
        return null;
    }
  })();

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
          {chat.isBusy && waitingHint && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
              <Hand className="size-3.5 shrink-0" />
              {waitingHint}
            </div>
          )}
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
