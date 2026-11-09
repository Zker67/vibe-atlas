import { create } from "zustand";
import type { Module, Project } from "@/mygo";

export interface ConfirmRequest {
  title: string;
  description?: string;
  confirmText?: string;
  destructive?: boolean;
  onConfirm(): void | Promise<void>;
}

/** What the project dialog adds or edits: a new project, or this one. */
export interface ProjectRequest {
  project: Project | null;
}

/** What the module dialog adds or edits: a new module of the open project, or this one. */
export interface ModuleRequest {
  module: Module | null;
}

/** The tabs of 设置. */
export type SettingsTab = "keys" | "items" | "appearance" | "data" | "updates";

interface DialogsState {
  confirm: ConfirmRequest | null;
  project: ProjectRequest | null;
  module: ModuleRequest | null;
  settings: boolean;
  settingsTab: SettingsTab;
  help: boolean;
  /** The section of 使用说明 to show first. */
  helpAt: string | null;
}

export const useDialogs = create<DialogsState>(() => ({
  confirm: null,
  project: null,
  module: null,
  settings: false,
  settingsTab: "keys",
  help: false,
  helpAt: null,
}));

/** Asks to confirm something that cannot be undone. */
export function askConfirm(request: ConfirmRequest) {
  useDialogs.setState({ confirm: request });
}

/** Opens the project dialog: to add a project, or to edit project's name, folder and icon. */
export function askProject(project: Project | null = null) {
  useDialogs.setState({ project: { project } });
}

/** Opens the module dialog: to add a module to the open project, or to edit module's name and icon. */
export function askModule(module: Module | null = null) {
  useDialogs.setState({ module: { module } });
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
