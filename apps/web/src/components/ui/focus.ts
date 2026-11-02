export interface OpenerRef {
  current: HTMLElement | null;
}

/**
 * Records what had focus when a sheet or dialog opened. Call it first thing in Radix's
 * `onOpenAutoFocus`: focus has not moved into the content yet at that point.
 */
export function rememberOpener(ref: OpenerRef): void {
  const active = document.activeElement;
  ref.current = active instanceof HTMLElement && active !== document.body ? active : null;
}

/**
 * `onCloseAutoFocus` handler. Radix only restores focus while the opener still exists; after an
 * entry was deleted or an editor route closed, the opener is gone and focus falls to <body>, which
 * strands keyboard users at the top of the document. Focus goes back to the opener when it is still
 * in the DOM, else to <main id="main"> so the next Tab lands in the page (DESIGN §10).
 */
export function restoreFocus(ref: OpenerRef, event: Event): void {
  event.preventDefault();
  const opener = ref.current;
  ref.current = null;
  const target = opener?.isConnected ? opener : document.getElementById('main');
  target?.focus({ preventScroll: true });
}

/** Focuses <main> when nothing in the page has focus (used after route changes). */
export function focusMainIfUnfocused(): void {
  const active = document.activeElement;
  if (active && active !== document.body) return;
  document.getElementById('main')?.focus({ preventScroll: true });
}
