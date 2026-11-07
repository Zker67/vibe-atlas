import type { KeyboardEvent as ReactKeyboardEvent } from "react";

type AnyKeyboardEvent = KeyboardEvent | ReactKeyboardEvent;

function native(e: AnyKeyboardEvent): KeyboardEvent {
  return "nativeEvent" in e ? e.nativeEvent : e;
}

/**
 * Whether an input method is composing: the Enter or Escape that commits or
 * cancels a Chinese candidate must not save or close anything.
 */
export function isComposing(e: AnyKeyboardEvent): boolean {
  const n = native(e);
  return n.isComposing || n.keyCode === 229;
}

/** Whether keys typed now go into a field, where shortcuts must not act. */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLElement && (el.isContentEditable || !!el.closest(".cm-editor"));
}

/** Whether a dialog or menu is open over the page. */
export function overlayOpen(): boolean {
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
}

const CODES: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  NumpadDecimal: "NumDec",
  NumpadAdd: "NumAdd",
  NumpadSubtract: "NumSub",
  NumpadMultiply: "NumMult",
  NumpadDivide: "NumDiv",
};

/** The key of a key press in MyGo's accelerator syntax, or "" for a modifier. */
function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (/^Numpad\d$/.test(code)) return "Num" + code.slice(6);
  return CODES[code] ?? "";
}

/**
 * The accelerator a key press makes, such as "Ctrl+Alt+Space", or "" while
 * only modifiers are down.
 */
export function acceleratorOf(e: AnyKeyboardEvent): string {
  const n = native(e);
  const key = keyName(n.code);
  if (!key) return "";
  const mods: string[] = [];
  if (n.ctrlKey) mods.push("Ctrl");
  if (n.altKey) mods.push("Alt");
  if (n.shiftKey) mods.push("Shift");
  if (n.metaKey) mods.push(navigator.platform.startsWith("Mac") ? "Cmd" : "Win");
  return [...mods, key].join("+");
}

/** The keys of an accelerator, to show as key caps. */
export function acceleratorKeys(accelerator: string): string[] {
  return accelerator.split("+").filter(Boolean);
}
