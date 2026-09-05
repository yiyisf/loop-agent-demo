import type { UserQuestion } from '@loop-agent/shared';
import { MessageCircleQuestion, Send } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useRunStore } from '@/stores/run-store';

export interface QuestionCardProps {
  question: UserQuestion;
  interactive: boolean;
}

export function QuestionCard({ question, interactive }: QuestionCardProps) {
  const pushNotice = useRunStore((s) => s.pushNotice);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = question.answer === undefined;

  const submit = async (answer: string) => {
    const text = answer.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api.answerQuestion(question.runId, question.id, text);
      setDraft('');
    } catch (err) {
      pushNotice('error', err instanceof Error ? err.message : '提交回答失败');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit(draft);
    }
  };

  return (
    <div
      className={cn(
        'rounded-xl border bg-card text-sm',
        pending && interactive && 'border-info/60 shadow-sm ring-2 ring-info/15',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <MessageCircleQuestion
          className={cn('size-4 shrink-0', pending ? 'text-info' : 'text-muted-foreground')}
        />
        <span className="font-medium">Agent 提问</span>
        <span className="text-xs text-muted-foreground">
          {question.stepId === 'reflector' ? '来自反思' : `步骤 ${question.stepId}`}
        </span>
        <span className="ml-auto">
          {pending ? (
            <Badge variant="info">{interactive ? '等待你的回答' : '未回答'}</Badge>
          ) : (
            <Badge variant="secondary">已回答</Badge>
          )}
        </span>
      </div>
      <div className="grid gap-2.5 border-t px-3 py-2.5">
        <p className="whitespace-pre-wrap">{question.question}</p>
        {!pending && (
          <div className="flex justify-end">
            <span className="rounded-2xl rounded-br-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">
              {question.answer}
            </span>
          </div>
        )}
        {pending && interactive && (
          <>
            {question.options && question.options.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {question.options.map((opt) => (
                  <Button
                    key={opt}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => submit(opt)}
                  >
                    {opt}
                  </Button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                name={`answer-${question.id}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={question.options?.length ? '或输入其他回答…' : '输入你的回答…'}
                aria-label="回答"
                className="h-8 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <Button
                type="button"
                size="sm"
                disabled={!draft.trim() || busy}
                onClick={() => submit(draft)}
              >
                <Send /> 回答
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
