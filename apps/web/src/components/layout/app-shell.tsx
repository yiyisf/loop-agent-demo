import { type ReactNode, type PointerEvent as ReactPointerEvent, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';
import { Sidebar } from './sidebar';
import { Workbench } from './workbench';

export function AppShell({ children }: { children: ReactNode }) {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const workbenchOpen = useUiStore((s) => s.workbenchOpen);
  const workbenchWidth = useUiStore((s) => s.workbenchWidth);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const setWorkbenchOpen = useUiStore((s) => s.setWorkbenchOpen);
  const setWorkbenchWidth = useUiStore((s) => s.setWorkbenchWidth);

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = useUiStore.getState().workbenchWidth;
      const move = (ev: PointerEvent) => {
        setWorkbenchWidth(startWidth + (startX - ev.clientX));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [setWorkbenchWidth],
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r bg-sidebar text-sidebar-foreground transition-transform duration-200 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:hidden',
        )}
      >
        <Sidebar />
      </aside>
      {sidebarOpen && (
        <button
          type="button"
          aria-label="关闭侧栏"
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col overflow-x-hidden">{children}</main>

      <aside
        data-testid="workbench-aside"
        style={{ width: workbenchWidth }}
        className={cn(
          'relative max-w-full shrink-0 border-l bg-card transition-transform duration-200',
          'fixed inset-y-0 right-0 z-40 xl:static xl:translate-x-0',
          workbenchOpen ? 'translate-x-0' : 'translate-x-full xl:hidden',
        )}
      >
        <button
          type="button"
          aria-label="调整工作台宽度"
          title="拖动调整工作台宽度"
          onPointerDown={onResizePointerDown}
          className="absolute inset-y-0 -left-1 z-10 hidden w-2.5 cursor-col-resize touch-none border-0 bg-transparent p-0 xl:flex xl:justify-center"
        >
          <span className="my-auto h-12 w-1 rounded-full bg-border hover:bg-primary/70" />
        </button>
        <Workbench />
      </aside>
      {workbenchOpen && (
        <button
          type="button"
          aria-label="关闭工作台"
          className="fixed inset-0 z-30 bg-black/30 xl:hidden"
          onClick={() => setWorkbenchOpen(false)}
        />
      )}
    </div>
  );
}
