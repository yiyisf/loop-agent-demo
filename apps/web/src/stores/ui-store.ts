import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark';

interface UiState {
  theme: Theme;
  sidebarOpen: boolean;
  workbenchOpen: boolean;
  selectedStepId: string | null;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleWorkbench: () => void;
  setWorkbenchOpen: (open: boolean) => void;
  selectStep: (stepId: string | null) => void;
}

const applyTheme = (theme: Theme) => {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('loop-agent-theme', theme);
};

const initialTheme = (): Theme => {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
};

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: initialTheme(),
      sidebarOpen: true,
      workbenchOpen: typeof window !== 'undefined' ? window.innerWidth >= 1280 : true,
      selectedStepId: null,
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleWorkbench: () => set((s) => ({ workbenchOpen: !s.workbenchOpen })),
      setWorkbenchOpen: (workbenchOpen) => set({ workbenchOpen }),
      selectStep: (selectedStepId) => set({ selectedStepId }),
    }),
    {
      name: 'loop-agent-ui',
      partialize: (s) => ({ sidebarOpen: s.sidebarOpen, workbenchOpen: s.workbenchOpen }),
    },
  ),
);
