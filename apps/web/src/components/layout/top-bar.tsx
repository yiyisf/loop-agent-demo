import { PanelLeft, PanelRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/stores/ui-store';

export function TopBar({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleWorkbench = useUiStore((s) => s.toggleWorkbench);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <Button variant="ghost" size="icon-sm" aria-label="切换侧栏" onClick={toggleSidebar}>
        <PanelLeft />
      </Button>
      <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
      {children}
      <Button variant="ghost" size="icon-sm" aria-label="切换工作台" onClick={toggleWorkbench}>
        <PanelRight />
      </Button>
    </header>
  );
}
