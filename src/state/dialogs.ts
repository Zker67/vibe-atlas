import { create } from "zustand";

export interface NameRequest {
  title: string;
  initial?: string;
  placeholder?: string;
  confirmText?: string;
  /** Saves the name; a rejection's message shows in the dialog. */
  onSubmit(name: string): Promise<unknown>;
}

export interface ConfirmRequest {
  title: string;
  description?: string;
  confirmText?: string;
  destructive?: boolean;
  onConfirm(): void | Promise<void>;
}

/** The tabs of 设置. */
export type SettingsTab = "capture" | "appearance" | "data";

interface DialogsState {
  name: NameRequest | null;
  confirm: ConfirmRequest | null;
  settings: boolean;
  settingsTab: SettingsTab;
  help: boolean;
  /** The section of 使用说明 to show first. */
  helpAt: string | null;
}

export const useDialogs = create<DialogsState>(() => ({
  name: null,
  confirm: null,
  settings: false,
  settingsTab: "capture",
  help: false,
  helpAt: null,
}));

/** Asks for a name, as for a new project or module. */
export function askName(request: NameRequest) {
  useDialogs.setState({ name: request });
}

/** Asks to confirm something that cannot be undone. */
export function askConfirm(request: ConfirmRequest) {
  useDialogs.setState({ confirm: request });
}

/** Opens or closes 设置, at the tab last shown; opening it closes 使用说明. */
export function openSettings(open = true) {
  useDialogs.setState(open ? { settings: true, help: false } : { settings: false });
}

/** Shows a tab of 设置, opening it if closed. */
export function showSettingsTab(tab: SettingsTab) {
  useDialogs.setState({ settings: true, settingsTab: tab, help: false });
}

/** Opens 使用说明, at a section if given; it closes 设置. */
export function openHelp(section?: string) {
  useDialogs.setState({ help: true, helpAt: section ?? null, settings: false });
}

export function closeHelp() {
  useDialogs.setState({ help: false });
}
