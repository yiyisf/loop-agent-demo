import { Check, Copy } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCopy } from './json-view';

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn(
        'prose-sm max-w-none text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold [&_hr]:my-4 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2 [&_table]:w-full [&_table]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-muted/60 [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
        className,
      )}
    >
      <Streamdown>{text}</Streamdown>
    </div>
  );
}

export function FinalAnswer({ text, streaming }: { text: string; streaming: boolean }) {
  const { copied, copy } = useCopy(text);
  if (!text) return null;
  return (
    <div className="group relative">
      <Markdown text={text} />
      {streaming && (
        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary/70 align-text-bottom" />
      )}
      {!streaming && (
        <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button type="button" variant="ghost" size="sm" onClick={copy}>
            {copied ? <Check className="text-success" /> : <Copy />}
            {copied ? '已复制' : '复制'}
          </Button>
        </div>
      )}
    </div>
  );
}
