// The right-click menu the page draws for what has no menu of its own:
// text (components/app/page-menu.tsx) and pictures (editor/picture-menu.ts).
// The main window shows it; quick capture, too small a window for it, has
// the system's (guardPage in app.go), and showPageMenu tells so.

import type { LucideIcon } from "lucide-react";

export interface MenuEntry {
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  disabled?: boolean;
  destructive?: boolean;
  /** Runs once the menu closed and the keyboard is back where it was. */
  run(): void;
}

/** A menu's entries; null between groups. */
export type MenuEntries = (MenuEntry | null)[];

export interface ShownMenu {
  x: number;
  y: number;
  entries: MenuEntries;
  /** Puts the keyboard back where the menu was opened, before an entry runs. */
  restore?: () => void;
}

let host: ((menu: ShownMenu) => void) | null = null;
let open = false;

/** Shows the menu at x, y; false where the page has no menu (quick capture). */
export function showPageMenu(menu: ShownMenu): boolean {
  if (!host) return false;
  host(menu);
  return true;
}

/** Whether the menu is open: keys are its own then. */
export function pageMenuOpen(): boolean {
  return open;
}

/** Called by the menu as it mounts: how to show it, and how to tell it is open. */
export function hostPageMenu(show: (menu: ShownMenu) => void): { setOpen(value: boolean): void; unhost(): void } {
  host = show;
  return {
    setOpen: (value) => {
      open = value;
    },
    unhost: () => {
      if (host === show) host = null;
      open = false;
    },
  };
}
