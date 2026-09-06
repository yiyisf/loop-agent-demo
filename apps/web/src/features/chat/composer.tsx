import { useQuery } from '@tanstack/react-query';
import { ArrowUp, Square } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api, queryKeys } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useRunStore } from '@/stores/run-store';

export interface ComposerProps {
  onSend: (text: string) => void;
  onStop?: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  size?: 'default' | 'large';
  id?: string;
}

export function Composer({
  onSend,
  onStop,
  busy,
  disabled,
  placeholder = '描述一个任务，Enter 发送，Shift+Enter 换行',
  autoFocus,
  className,
  size = 'default',
  id = 'composer-input',
}: ComposerProps) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const mode = useRunStore((s) => s.mode);
  const setMode = useRunStore((s) => s.setMode);
  const model = useRunStore((s) => s.model);
  const setModel = useRunStore((s) => s.setModel);
  const autoApprove = useRunStore((s) => s.autoApprove);
  const setAutoApprove = useRunStore((s) => s.setAutoApprove);
  const models = useQuery({
    queryKey: queryKeys.models,
    queryFn: api.models,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  const submit = () => {
    if (!value.trim() || busy || disabled) return;
    onSend(value);
    setValue('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className={cn(
        'rounded-2xl border bg-card shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-2 focus-within:ring-ring/30',
        className,
      )}
    >
      <Textarea
        ref={ref}
        id={id}
        name="prompt"
        aria-label="任务输入"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={size === 'large' ? 3 : 1}
        className={cn(
          'max-h-60 min-h-0 resize-none border-0 bg-transparent px-4 pt-3 pb-1 shadow-none focus-visible:ring-0',
          size === 'large' && 'text-base',
        )}
      />
      <div className="flex items-center gap-3 px-3 pb-2.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <label
              htmlFor={`${id}-plan-first`}
              className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
            >
              <Switch
                id={`${id}-plan-first`}
                checked={mode === 'plan_first'}
                onCheckedChange={(v) => setMode(v ? 'plan_first' : 'auto')}
                aria-label="先确认计划"
              />
              先确认计划
            </label>
          </TooltipTrigger>
          <TooltipContent>开启后，Agent 会先展示计划，待你确认后再执行</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <label
              htmlFor={`${id}-auto-approve`}
              className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
            >
              <Switch
                id={`${id}-auto-approve`}
                checked={autoApprove}
                onCheckedChange={setAutoApprove}
                aria-label="自动批准工具"
              />
              自动批准
            </label>
          </TooltipTrigger>
          <TooltipContent>关闭时，中/高风险工具（如网页抓取）调用前会请求你的批准</TooltipContent>
        </Tooltip>

        {models.data && models.data.models.length > 1 && (
          <select
            aria-label="模型"
            name="model"
            className="h-7 rounded-md border bg-background px-2 text-xs"
            value={model ?? models.data.default}
            onChange={(e) =>
              setModel(e.target.value === models.data?.default ? undefined : e.target.value)
            }
          >
            {models.data.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
        {models.data && models.data.provider === 'mock' && (
          <span className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] text-warning">
            Mock 模型
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {busy ? (
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              aria-label="停止"
              onClick={onStop}
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-sm"
              aria-label="发送"
              onClick={submit}
              disabled={!value.trim() || disabled}
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
