import { create } from "zustand";

// Whether the sidebar is folded into a rail of icons, and whether its
// finished projects are shown, both kept on this machine.

const KEY = "vibe-atlas-sidebar-collapsed";
const FINISHED_KEY = "vibe-atlas-sidebar-finished-open";

export const useSidebar = create<{ collapsed: boolean; finishedOpen: boolean }>(() => ({
  collapsed: localStorage.getItem(KEY) === "1",
  finishedOpen: localStorage.getItem(FINISHED_KEY) === "1",
}));

export function toggleSidebar() {
  const collapsed = !useSidebar.getState().collapsed;
  useSidebar.setState({ collapsed });
  localStorage.setItem(KEY, collapsed ? "1" : "0");
}

/** Shows the finished projects at the bottom of the list, or folds them away. */
export function toggleFinished() {
  const finishedOpen = !useSidebar.getState().finishedOpen;
  useSidebar.setState({ finishedOpen });
  localStorage.setItem(FINISHED_KEY, finishedOpen ? "1" : "0");
}
