import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Calculator, FileText, Globe, Route as RouteIcon, Sparkles } from 'lucide-react';
import { TopBar } from '@/components/layout/top-bar';
import { Composer } from '@/features/chat/composer';
import { api, queryKeys } from '@/lib/api';
import { useRunStore } from '@/stores/run-store';

export const Route = createFileRoute('/')({
  component: IndexPage,
});

const suggestions = [
  {
    icon: Globe,
    title: '调研对比',
    text: '对比 Zustand、Jotai 与 Redux Toolkit 三个状态管理库的适用场景、包体积和学习成本，给出选型建议。',
  },
  {
    icon: Calculator,
    title: '数据计算',
    text: '一台服务器月租 1280 元，年付享 8.5 折，另需一次性安装费 300 元；计算年付与月付两年的总成本差异。',
  },
  {
    icon: FileText,
    title: '文档产出',
    text: '为一个内部 CLI 工具编写 README 草稿，包含简介、安装、常用命令与常见问题，并保存到工作区。',
  },
  {
    icon: RouteIcon,
    title: '规划方案',
    text: '先问我团队规模与预算，再为一个 5 人前端团队设计从 Webpack 迁移到 Vite 的分阶段方案与风险清单。',
  },
];

function IndexPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setPendingMessage = useRunStore((s) => s.setPendingMessage);

  const start = useMutation({
    mutationFn: async (text: string) => {
      const thread = await api.createThread();
      return { thread, text };
    },
    onSuccess: ({ thread, text }) => {
      setPendingMessage({ threadId: thread.id, text });
      void queryClient.invalidateQueries({ queryKey: queryKeys.threads });
      void navigate({ to: '/threads/$threadId', params: { threadId: thread.id } });
    },
  });

  return (
    <>
      <TopBar title="新任务" />
      <div className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto p-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">今天想完成什么任务？</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            描述一个多步骤任务，Agent 会先制定计划，再逐步执行并在过程中动态调整。
          </p>
        </div>

        <div className="w-full max-w-2xl">
          <Composer
            onSend={(text) => start.mutate(text)}
            busy={start.isPending}
            autoFocus
            size="large"
            placeholder="例如：调研三个方案并给出选型建议…"
          />
          {start.error && <p className="mt-2 text-xs text-destructive">{start.error.message}</p>}
        </div>

        <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
          {suggestions.map((s) => (
            <button
              type="button"
              key={s.title}
              onClick={() => start.mutate(s.text)}
              disabled={start.isPending}
              className="rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent/60 disabled:opacity-60"
            >
              <s.icon className="mb-2 size-4 text-muted-foreground" />
              <p className="text-sm font-medium">{s.title}</p>
              <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{s.text}</p>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
