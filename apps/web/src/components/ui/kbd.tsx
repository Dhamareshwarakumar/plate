/** A keyboard key as shown in shortcut hints and the shortcuts help. */
export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="bg-surface-2 border-border text-fg inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 font-sans text-xs font-medium shadow-[inset_0_-1px_0_var(--border)]">
      {children}
    </kbd>
  );
}
