import { useEffect } from 'react';

type Hotkey = {
  key: string;
  /** Require Cmd (macOS) or Ctrl (elsewhere). */
  mod?: boolean;
};

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * Window-level keyboard shortcut. Plain (non-modifier) keys are ignored while the
 * user is typing in a form control so they never swallow normal input.
 */
export function useHotkey(hotkey: Hotkey, handler: (e: KeyboardEvent) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== hotkey.key.toLowerCase()) return;
      if (hotkey.mod) {
        if (!(e.metaKey || e.ctrlKey)) return;
      } else if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      } else if (isEditable(e.target) && e.key !== 'Escape') {
        return;
      }
      e.preventDefault();
      handler(e);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hotkey.key, hotkey.mod, handler, enabled]);
}
