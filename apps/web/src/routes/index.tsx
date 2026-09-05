import { createFileRoute } from '@tanstack/react-router';
import { TopBar } from '@/components/layout/top-bar';

export const Route = createFileRoute('/')({
  component: IndexPage,
});

function IndexPage() {
  return (
    <>
      <TopBar title="新任务" />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">今天想完成什么任务？</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          描述一个多步骤任务，Agent 会先制定计划，再逐步执行并在过程中动态调整。
        </p>
      </div>
    </>
  );
}
