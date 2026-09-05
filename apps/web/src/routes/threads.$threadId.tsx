import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { TopBar } from '@/components/layout/top-bar';
import { Spinner } from '@/components/ui/spinner';
import { ThreadChat } from '@/features/chat/thread-chat';
import { api, queryKeys } from '@/lib/api';

export const Route = createFileRoute('/threads/$threadId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: queryKeys.thread(params.threadId),
      queryFn: () => api.getThread(params.threadId),
    }),
  component: ThreadPage,
  errorComponent: ({ error }) => (
    <>
      <TopBar title="会话" />
      <div className="flex flex-1 items-center justify-center text-sm text-destructive">
        {error.message}
      </div>
    </>
  ),
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  const detail = useQuery({
    queryKey: queryKeys.thread(threadId),
    queryFn: () => api.getThread(threadId),
  });

  if (!detail.data) {
    return (
      <>
        <TopBar title="会话" />
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </>
    );
  }

  return <ThreadChat key={threadId} threadId={threadId} detail={detail.data} />;
}
