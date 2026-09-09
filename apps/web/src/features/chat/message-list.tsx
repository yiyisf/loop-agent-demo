import type { AttachmentPreview } from '@loop-agent/shared';
import { ArrowDown, Paperclip } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AgentUIMessage } from '@/lib/types';
import { AssistantMessage } from './assistant-message';

export function messageText(message: AgentUIMessage): string {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

function userAttachments(message: AgentUIMessage): AttachmentPreview[] {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: 'data-attachment' }> => p.type === 'data-attachment')
    .map((p) => p.data);
}

function UserMessage({ message }: { message: AgentUIMessage }) {
  const text = messageText(message);
  const files = userAttachments(message);
  return (
    <div className="flex justify-end" data-testid="user-message">
      <div className="max-w-[85%] min-w-0 space-y-1.5">
        {files.length > 0 && (
          <ul className="flex flex-wrap justify-end gap-1">
            {files.map((f) => (
              <li
                key={f.name}
                className="inline-flex max-w-full items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-xs"
              >
                <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{f.name}</span>
              </li>
            ))}
          </ul>
        )}
        {text ? (
          <div className="rounded-md bg-muted px-4 py-2.5 text-sm break-all whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground">
            {text}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  isStreaming,
  onRerun,
}: {
  messages: AgentUIMessage[];
  isStreaming: boolean;
  /** Re-submits the given user input as a new run (retry / regenerate). */
  onRerun?: (text: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever messages change
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !pinned) return;
    el.scrollTo({ top: el.scrollHeight });
  }, [messages, pinned]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinned(distance < 80);
  };

  const lastAssistantIndex = messages.findLastIndex((m) => m.role === 'assistant');
  const lastAssistantId = messages[lastAssistantIndex]?.id;
  const precedingUser = messages
    .slice(0, Math.max(lastAssistantIndex, 0))
    .findLast((m) => m.role === 'user');
  const rerunText = precedingUser ? messageText(precedingUser) : '';
  const rerun = onRerun && rerunText && !isStreaming ? () => onRerun(rerunText) : undefined;

  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="h-full min-w-0 overflow-x-hidden overflow-y-auto scrollbar-thin"
      >
        <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.map((m) =>
            m.role === 'user' ? (
              <UserMessage key={m.id} message={m} />
            ) : (
              <AssistantMessage
                key={m.id}
                message={m}
                isLatest={m.id === lastAssistantId}
                isStreaming={isStreaming}
                onRerun={m.id === lastAssistantId ? rerun : undefined}
              />
            ),
          )}
        </div>
      </div>
      {!pinned && (
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label="滚动到底部"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
          onClick={() => {
            setPinned(true);
            containerRef.current?.scrollTo({
              top: containerRef.current.scrollHeight,
              behavior: 'smooth',
            });
          }}
        >
          <ArrowDown />
        </Button>
      )}
    </div>
  );
}
