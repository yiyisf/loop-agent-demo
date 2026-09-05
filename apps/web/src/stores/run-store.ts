import type { RunMode } from '@loop-agent/shared';
import { create } from 'zustand';

export interface StepLog {
  text: string;
  reasoning: string;
}

export interface Notice {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  at: number;
}

interface RunStoreState {
  /** Transient per-step process text, keyed by runId then stepId. */
  stepLogs: Record<string, Record<string, StepLog>>;
  notices: Notice[];
  /** Message queued from the landing page to be sent once the thread page mounts. */
  pendingMessage: { threadId: string; text: string } | null;
  mode: RunMode;
  model: string | undefined;
  appendStepLog: (runId: string, stepId: string, kind: 'text' | 'reasoning', delta: string) => void;
  pushNotice: (level: Notice['level'], message: string) => void;
  dismissNotice: (id: number) => void;
  setPendingMessage: (p: RunStoreState['pendingMessage']) => void;
  setMode: (mode: RunMode) => void;
  setModel: (model: string | undefined) => void;
}

let noticeSeq = 0;

export const useRunStore = create<RunStoreState>()((set) => ({
  stepLogs: {},
  notices: [],
  pendingMessage: null,
  mode: 'auto',
  model: undefined,
  appendStepLog: (runId, stepId, kind, delta) =>
    set((s) => {
      const forRun = s.stepLogs[runId] ?? {};
      const log = forRun[stepId] ?? { text: '', reasoning: '' };
      return {
        stepLogs: {
          ...s.stepLogs,
          [runId]: { ...forRun, [stepId]: { ...log, [kind]: log[kind] + delta } },
        },
      };
    }),
  pushNotice: (level, message) =>
    set((s) => ({
      notices: [...s.notices.slice(-4), { id: ++noticeSeq, level, message, at: Date.now() }],
    })),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  setPendingMessage: (pendingMessage) => set({ pendingMessage }),
  setMode: (mode) => set({ mode }),
  setModel: (model) => set({ model }),
}));
