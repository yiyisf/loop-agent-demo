import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useHotkey } from '@/hooks/use-hotkey';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  const navigate = useNavigate();
  useHotkey(
    { key: 'k', mod: true },
    useCallback(() => {
      void navigate({ to: '/' });
      requestAnimationFrame(() => document.getElementById('composer-input')?.focus());
    }, [navigate]),
  );

  return (
    <TooltipProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </TooltipProvider>
  );
}
