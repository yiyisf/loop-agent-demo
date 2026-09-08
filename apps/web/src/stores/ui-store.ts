import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark';

export const WORKBENCH_WIDTH_MIN = 280;
export const WORKBENCH_WIDTH_MAX = 720;
export const WORKBENCH_WIDTH_DEFAULT = 420;

interface UiState {
  theme: Theme;
  sidebarOpen: boolean;
  workbenchOpen: boolean;
  workbenchWidth: number;
  selectedStepId: string | null;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleWorkbench: () => void;
  setWorkbenchOpen: (open: boolean) => void;
  setWorkbenchWidth: (width: number) => void;
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
      workbenchWidth: WORKBENCH_WIDTH_DEFAULT,
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
      setWorkbenchWidth: (width) =>
        set({
          workbenchWidth: Math.min(WORKBENCH_WIDTH_MAX, Math.max(WORKBENCH_WIDTH_MIN, width)),
        }),
      selectStep: (selectedStepId) => set({ selectedStepId }),
    }),
    {
      name: 'loop-agent-ui',
      partialize: (s) => ({
        sidebarOpen: s.sidebarOpen,
        workbenchOpen: s.workbenchOpen,
        workbenchWidth: s.workbenchWidth,
      }),
    },
  ),
);
