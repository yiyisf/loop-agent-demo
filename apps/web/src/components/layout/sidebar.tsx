import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Bot, Loader2, Moon, Plus, Sun, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, queryKeys } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';

export function Sidebar() {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { threadId?: string };

  const threads = useQuery({
    queryKey: queryKeys.threads,
    queryFn: api.listThreads,
    refetchInterval: (q) => (q.state.data?.some((t) => t.activeRunId) ? 5000 : false),
  });

  const remove = useMutation({
    mutationFn: api.deleteThread,
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.threads });
      if (params.threadId === id) void navigate({ to: '/' });
    },
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Bot className="size-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight">Loop Agent</span>
      </div>

      <div className="px-3">
        <Button asChild variant="outline" className="w-full justify-start">
          <Link to="/" onClick={() => setSidebarOpen(window.innerWidth >= 1024)}>
            <Plus />
            新任务
          </Link>
        </Button>
      </div>

      <nav className="mt-4 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 text-sm scrollbar-thin">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">会话</p>
        {threads.isLoading && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">加载中…</p>
        )}
        {threads.data?.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">暂无会话</p>
        )}
        <ul className="grid gap-0.5">
          {threads.data?.map((t) => (
            <li key={t.id} className="group relative">
              <Link
                to="/threads/$threadId"
                params={{ threadId: t.id }}
                onClick={() => setSidebarOpen(window.innerWidth >= 1024)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 pr-8 hover:bg-accent',
                  params.threadId === t.id && 'bg-accent font-medium',
                )}
              >
                {t.activeRunId && <Loader2 className="size-3 shrink-0 animate-spin text-info" />}
                <span className="min-w-0 truncate">{t.title || '未命名会话'}</span>
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="删除会话"
                className="absolute top-1/2 right-1 size-6 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => remove.mutate(t.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex items-center justify-between border-t px-3 py-3">
        <span className="text-xs text-muted-foreground">v0.1</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'}
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
      </div>
    </div>
  );
}
