import { PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/stores/ui-store';

export function Workbench() {
  const setWorkbenchOpen = useUiStore((s) => s.setWorkbenchOpen);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between border-b px-3">
        <span className="text-sm font-medium">工作台</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="收起工作台"
          onClick={() => setWorkbenchOpen(false)}
        >
          <PanelRightClose />
        </Button>
      </div>
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        运行开始后，这里会显示计划 DAG、步骤详情与事件时间线。
      </div>
    </div>
  );
}
