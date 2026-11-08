import { useSyncExternalStore } from "react";

/**
 * The key that, held down, makes deleting skip the trash: Shift, as Shift+Delete in
 * Windows Explorer. One place to change it, for macOS (where Finder uses Cmd+Option).
 */
export const PURGE_KEY = "Shift";

/** Whether a key press or click holds the key that deletes for good. */
export function purgeHeld(e: { shiftKey: boolean }): boolean {
  return e.shiftKey;
}

let held = false;
const listeners = new Set<() => void>();

function update(next: boolean) {
  if (next === held) return;
  held = next;
  for (const l of listeners) l();
}

let started = false;

const onKey = (e: KeyboardEvent) => update(purgeHeld(e));

/** Follows the key from the window, caught before menus and fields can stop it. */
function start() {
  if (started) return;
  started = true;
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
  // A pointer that moves tells too: the key may have gone up in another window.
  window.addEventListener("pointermove", (e) => update(purgeHeld(e)), { capture: true, passive: true });
  window.addEventListener("blur", () => update(false));
}

/** Whether the key that deletes for good is down now, for menus whose events do not say. */
export function purgeKeyDown(): boolean {
  start();
  return held;
}

/** Whether the key that deletes for good is down; buttons and menus show it. */
export function usePurgeKey(): boolean {
  return useSyncExternalStore(
    (l) => {
      start();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => held,
  );
}
