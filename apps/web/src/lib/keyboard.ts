import { useEffect, useRef } from 'react';

export type ShortcutMap = Record<string, (event: KeyboardEvent) => void>;

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * Single-key shortcuts for desktop (`ArrowLeft`, `t`, `n`, `/`…). Letters are matched lower-case.
 * Ignored while typing in a field, while a dialog or menu is open, or with a modifier held.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap, enabled = true): void {
  const latest = useRef<ShortcutMap>(shortcuts);
  useEffect(() => {
    latest.current = shortcuts;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(EDITABLE)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const handler = latest.current[key];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
