import { createFileRoute } from '@tanstack/react-router';
import { TopBar } from '@/components/layout/top-bar';

export const Route = createFileRoute('/threads/$threadId')({
  component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  return (
    <>
      <TopBar title={`会话 ${threadId}`} />
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        会话内容将在此显示。
      </div>
    </>
  );
}
