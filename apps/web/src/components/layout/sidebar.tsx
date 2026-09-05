import { Link } from '@tanstack/react-router';
import { Bot, Moon, Plus, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/stores/ui-store';

export function Sidebar() {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

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
          <Link to="/">
            <Plus />
            新任务
          </Link>
        </Button>
      </div>

      <nav className="mt-4 flex-1 overflow-y-auto px-3 text-sm">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">会话</p>
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">暂无会话</p>
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
