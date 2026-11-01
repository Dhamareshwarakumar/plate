/** Whether the first-run checklist (FR-O1) was dismissed or completed on this device. */
const KEY = 'plate.firstRun.dismissed';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readFirstRunDismissed(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeFirstRunDismissed(): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, '1');
  } catch {
    // Storage full or disabled: the checklist simply shows again next time.
  }
}
