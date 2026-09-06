import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Bot, Loader2, Moon, Pencil, Plus, Search, Sun, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, queryKeys } from '@/lib/api';
import type { ThreadListItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';

type GroupKey = 'today' | 'yesterday' | 'week' | 'older';
const GROUP_LABELS: Record<GroupKey, string> = {
  today: '今天',
  yesterday: '昨天',
  week: '近 7 天',
  older: '更早',
};
const GROUP_ORDER: GroupKey[] = ['today', 'yesterday', 'week', 'older'];

function groupOf(iso: string, now = new Date()): GroupKey {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = new Date(iso).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (t >= startOfToday) return 'today';
  if (t >= startOfToday - day) return 'yesterday';
  if (t >= startOfToday - 6 * day) return 'week';
  return 'older';
}

export function groupThreads(threads: ThreadListItem[], now = new Date()) {
  const groups = new Map<GroupKey, ThreadListItem[]>();
  for (const t of threads) {
    const key = groupOf(t.updatedAt, now);
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  return GROUP_ORDER.filter((k) => groups.has(k)).map((k) => ({
    key: k,
    label: GROUP_LABELS[k],
    threads: groups.get(k)!,
  }));
}

export function Sidebar() {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { threadId?: string };
  const [query, setQuery] = useState('');

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

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.renameThread(id, title),
    onSuccess: (_, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.threads });
      void queryClient.invalidateQueries({ queryKey: queryKeys.thread(id) });
    },
  });

  const filtered = useMemo(() => {
    const list = threads.data ?? [];
    const q = query.trim().toLowerCase();
    return q ? list.filter((t) => (t.title || '未命名会话').toLowerCase().includes(q)) : list;
  }, [threads.data, query]);
  const groups = useMemo(() => groupThreads(filtered), [filtered]);

  const onRename = (t: ThreadListItem) => {
    const next = window.prompt('重命名会话', t.title);
    if (next === null) return;
    const title = next.trim();
    if (title && title !== t.title) rename.mutate({ id: t.id, title });
  };

  const closeOnNarrow = () => setSidebarOpen(window.innerWidth >= 1024);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Bot className="size-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight">Loop Agent</span>
      </div>

      <div className="grid gap-2 px-3">
        <Button asChild variant="outline" className="w-full justify-start">
          <Link to="/" onClick={closeOnNarrow}>
            <Plus />
            新任务
          </Link>
        </Button>
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            name="thread-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话"
            aria-label="搜索会话"
            className="h-8 w-full rounded-md border bg-background pr-7 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </label>
      </div>

      <nav className="mt-3 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 text-sm scrollbar-thin">
        {threads.isLoading && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">加载中…</p>
        )}
        {threads.isError && (
          <p className="px-2 py-4 text-center text-xs text-destructive">会话加载失败</p>
        )}
        {threads.data && filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {query ? '没有匹配的会话' : '暂无会话'}
          </p>
        )}
        {groups.map((group) => (
          <section key={group.key} className="mb-3">
            <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">{group.label}</p>
            <ul className="grid gap-0.5">
              {group.threads.map((t) => (
                <li key={t.id} className="group relative">
                  <Link
                    to="/threads/$threadId"
                    params={{ threadId: t.id }}
                    onClick={closeOnNarrow}
                    onDoubleClick={() => onRename(t)}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 pr-14 hover:bg-accent',
                      params.threadId === t.id && 'bg-accent font-medium',
                    )}
                  >
                    {t.activeRunId && (
                      <Loader2 className="size-3 shrink-0 animate-spin text-info" />
                    )}
                    <span className="min-w-0 truncate">{t.title || '未命名会话'}</span>
                  </Link>
                  <div
                    className={cn(
                      'absolute top-1/2 right-1 flex -translate-y-1/2 items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100',
                      params.threadId === t.id && 'opacity-100',
                    )}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="重命名会话"
                      className="size-6"
                      onClick={() => onRename(t)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="删除会话"
                      className="size-6"
                      onClick={() => {
                        if (window.confirm(`删除会话「${t.title || '未命名会话'}」？`))
                          remove.mutate(t.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
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
