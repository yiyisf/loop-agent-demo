import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';
import { Sidebar } from './sidebar';
import { Workbench } from './workbench';

export function AppShell({ children }: { children: ReactNode }) {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const workbenchOpen = useUiStore((s) => s.workbenchOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const setWorkbenchOpen = useUiStore((s) => s.setWorkbenchOpen);

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

      <main className="flex min-w-0 flex-1 flex-col">{children}</main>

      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-40 w-[380px] max-w-full shrink-0 border-l bg-card transition-transform duration-200 xl:static xl:translate-x-0',
          workbenchOpen ? 'translate-x-0' : 'translate-x-full xl:hidden',
        )}
      >
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
