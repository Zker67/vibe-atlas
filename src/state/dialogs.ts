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

interface DialogsState {
  name: NameRequest | null;
  confirm: ConfirmRequest | null;
  settings: boolean;
}

export const useDialogs = create<DialogsState>(() => ({ name: null, confirm: null, settings: false }));

/** Asks for a name, as for a new project or module. */
export function askName(request: NameRequest) {
  useDialogs.setState({ name: request });
}

/** Asks to confirm something that cannot be undone. */
export function askConfirm(request: ConfirmRequest) {
  useDialogs.setState({ confirm: request });
}

export function openSettings(open = true) {
  useDialogs.setState({ settings: open });
}
