import { create } from "zustand";

// Whether the sidebar is folded into a rail of icons, kept on this machine.

const KEY = "vibe-atlas-sidebar-collapsed";

export const useSidebar = create<{ collapsed: boolean }>(() => ({
  collapsed: localStorage.getItem(KEY) === "1",
}));

export function toggleSidebar() {
  const collapsed = !useSidebar.getState().collapsed;
  useSidebar.setState({ collapsed });
  localStorage.setItem(KEY, collapsed ? "1" : "0");
}
