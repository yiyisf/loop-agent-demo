import type { AttachmentDraft } from '@loop-agent/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api, queryKeys } from '@/lib/api';
import { cn, formatBytes } from '@/lib/utils';
import { useRunStore } from '@/stores/run-store';

const MAX_FILES = 8;
const MAX_BYTES = 400_000;
const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.html', '.xml']);
const ACCEPT =
  '.txt,.md,.markdown,.json,.csv,.html,.xml,.pdf,text/plain,text/markdown,application/json,text/csv,application/pdf';

export interface ComposerSend {
  text: string;
  attachments: AttachmentDraft[];
}

export interface ComposerProps {
  onSend: (payload: ComposerSend) => void;
  onStop?: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  size?: 'default' | 'large';
  id?: string;
}

function extname(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function isAllowed(file: File): boolean {
  const ext = extname(file.name);
  if (ext === '.pdf' || file.type === 'application/pdf') return true;
  if (TEXT_EXT.has(ext) || file.type.startsWith('text/') || /json|csv|xml/.test(file.type)) {
    return true;
  }
  return false;
}

function draftSize(f: AttachmentDraft): number {
  if (f.text) return new TextEncoder().encode(f.text).length;
  if (f.dataBase64) {
    const cleaned = f.dataBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
    return Math.floor((cleaned.length * 3) / 4);
  }
  return 0;
}

async function fileToDraft(file: File): Promise<AttachmentDraft> {
  const ext = extname(file.name);
  const isPdf = ext === '.pdf' || file.type === 'application/pdf';
  if (isPdf) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return {
      name: file.name,
      mime: 'application/pdf',
      dataBase64: btoa(binary),
    };
  }
  return {
    name: file.name,
    mime: file.type || 'text/plain',
    text: await file.text(),
  };
}

export function Composer({
  onSend,
  onStop,
  busy,
  disabled,
  placeholder = '输入消息或任务，Enter 发送，Shift+Enter 换行',
  autoFocus,
  className,
  size = 'default',
  id = 'composer-input',
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  const addFiles = async (list: FileList | File[]) => {
    const incoming = [...list];
    if (incoming.length === 0) return;
    setError(null);
    const next = [...attachments];
    for (const file of incoming) {
      if (next.length >= MAX_FILES) {
        setError(`一次最多上传 ${MAX_FILES} 个文件`);
        break;
      }
      if (!isAllowed(file)) {
        setError(`不支持「${file.name}」（仅文本、Markdown、JSON、CSV、小 PDF）`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setError(`「${file.name}」超过 ${Math.round(MAX_BYTES / 1024)}KB 上限`);
        continue;
      }
      next.push(await fileToDraft(file));
    }
    setAttachments(next);
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setError(null);
  };

  const canSend = (!!value.trim() || attachments.length > 0) && !busy && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSend({ text: value, attachments });
    setValue('');
    setAttachments([]);
    setError(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled || busy) return;
    void addFiles(e.dataTransfer.files);
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData.files;
    if (files.length === 0) return;
    e.preventDefault();
    void addFiles(files);
  };

  return (
    <div
      className={cn(
        'rounded-md border bg-card transition-shadow focus-within:ring-1 focus-within:ring-ring/40',
        dragging && 'border-foreground/40 ring-1 ring-ring/40',
        className,
      )}
      onDragEnter={(e) => {
        e.preventDefault();
        if (!disabled && !busy) setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled && !busy) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-3 pt-2.5" data-testid="composer-attachments">
          {attachments.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex max-w-full items-center gap-1 rounded-md border bg-muted/60 px-2 py-0.5 text-xs"
            >
              <span className="truncate">{f.name}</span>
              <span className="text-muted-foreground">{formatBytes(draftSize(f))}</span>
              <button
                type="button"
                aria-label={`移除 ${f.name}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => removeAttachment(i)}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Textarea
        ref={ref}
        id={id}
        name="prompt"
        aria-label="任务输入"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={size === 'large' ? 3 : 1}
        className={cn(
          'max-h-60 min-h-0 resize-none border-0 bg-transparent px-4 pt-3 pb-1 shadow-none focus-visible:ring-0',
          size === 'large' && 'text-base',
        )}
      />
      {error && <p className="px-4 pb-1 text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-3 px-3 pb-2.5">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          aria-label="选择要上传的文件"
          disabled={disabled || busy || attachments.length >= MAX_FILES}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            if (e.target.files) void addFiles(e.target.files);
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="添加附件"
              disabled={disabled || busy || attachments.length >= MAX_FILES}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>添加文本、Markdown、JSON、CSV 或小 PDF</TooltipContent>
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
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
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
            <Button type="button" size="icon-sm" aria-label="发送" onClick={submit} disabled={!canSend}>
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
