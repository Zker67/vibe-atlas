import { useSyncExternalStore } from "react";

// The window follows the appearance Go sets (mygo.Theme.SetSource), which
// pages see through prefers-color-scheme.
const query = () => window.matchMedia("(prefers-color-scheme: dark)");

/** Keeps the dark class of <html>, which the theme tokens key on, in step. */
export function syncDarkClass() {
  const apply = () => document.documentElement.classList.toggle("dark", query().matches);
  apply();
  query().addEventListener("change", apply);
}

function subscribe(onChange: () => void) {
  const q = query();
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
}

/** Whether the window is dark now. */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, () => query().matches);
}
