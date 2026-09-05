import { ArrowDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AgentUIMessage } from '@/lib/types';
import { AssistantMessage } from './assistant-message';

function UserMessage({ message }: { message: AgentUIMessage }) {
  const text = message.parts
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
        {text}
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  isStreaming,
}: {
  messages: AgentUIMessage[];
  isStreaming: boolean;
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

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={containerRef} onScroll={onScroll} className="h-full overflow-y-auto scrollbar-thin">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.map((m) =>
            m.role === 'user' ? (
              <UserMessage key={m.id} message={m} />
            ) : (
              <AssistantMessage
                key={m.id}
                message={m}
                isLatest={m.id === lastAssistantId}
                isStreaming={isStreaming}
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
