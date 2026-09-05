import { create } from 'zustand';
import type { RunView } from '@/lib/run-view';

interface WorkbenchState {
  runView: RunView | null;
  threadId: string | null;
  setActive: (threadId: string | null, runView: RunView | null) => void;
}

export const useWorkbenchStore = create<WorkbenchState>()((set) => ({
  runView: null,
  threadId: null,
  setActive: (threadId, runView) => set({ threadId, runView }),
}));
