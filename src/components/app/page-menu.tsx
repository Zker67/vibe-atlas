// The main window's own right-click menu for text: in a field or a note,
// 剪切 / 复制 / 粘贴 / 全选; on text selected elsewhere, 复制. Pictures
// show it with entries of their own (editor/picture-menu.ts). Menus the
// page has already, as the queue's, keep theirs: a field inside them, as
// a row being renamed, gets this one.

import { useEffect, useRef, useState } from "react";
import { selectAll as selectAllText } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { ClipboardPaste, Copy, Scissors, TextSelect } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyText } from "@/components/editor/live-preview";
import { errorMessage } from "@/lib/api";
import { hostPageMenu, type MenuEntries, type ShownMenu } from "@/lib/page-menu";
import { Atlas, type ClipboardContent } from "@/mygo";

/** Inputs that hold text one types. */
const textInputs = new Set(["text", "search", "url", "email", "tel", "password", ""]);

type TextTarget =
  | { kind: "field"; el: HTMLInputElement | HTMLTextAreaElement }
  | { kind: "editor"; view: EditorView }
  | { kind: "editable"; el: HTMLElement };

/** The text one right-clicked in: a field, a Markdown editor or other editable content. */
function textTarget(target: Element): TextTarget | null {
  const field = target.closest("input, textarea");
  if (field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement && textInputs.has(field.type))) {
    return field.disabled ? null : { kind: "field", el: field };
  }
  if (field) return null;
  const content = target.closest<HTMLElement>(".cm-content");
  const view = content && EditorView.findFromDOM(content);
  if (view) return { kind: "editor", view };
  const editable = target.closest<HTMLElement>("[contenteditable]");
  return editable?.isContentEditable ? { kind: "editable", el: editable } : null;
}

function writable(t: TextTarget): boolean {
  if (t.kind === "field") return !t.el.readOnly;
  if (t.kind === "editor") return !t.view.state.readOnly;
  return true;
}

function selectedText(t: TextTarget): string {
  if (t.kind === "field") {
    const { selectionStart: from, selectionEnd: to, value } = t.el;
    return from === null || to === null ? "" : value.slice(from, to);
  }
  if (t.kind === "editor") {
    const { state } = t.view;
    return state.selection.ranges.map((r) => state.sliceDoc(r.from, r.to)).join(state.lineBreak);
  }
  return window.getSelection()?.toString() ?? "";
}

function refocus(t: TextTarget) {
  if (t.kind === "editor") t.view.focus();
  else t.el.focus({ preventScroll: true });
}

/** Cuts or copies the selection as the keys would, in the field the keyboard is back in. */
function cutOrCopy(t: TextTarget, command: "cut" | "copy") {
  if (document.execCommand(command)) return;
  // Where the page may not use the old way: the text, and for 剪切 its deletion.
  const text = selectedText(t);
  void copyText(text);
  if (command === "cut" && text) document.execCommand("delete");
}

function bytes(base64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Pastes what is on the clipboard as Ctrl+V would: the field's own paste
 * handling gets it first, as the notes' turns pictures into pictures; else
 * its text goes in where the cursor is.
 */
async function paste(t: TextTarget) {
  let clip: ClipboardContent;
  try {
    clip = await Atlas.readClipboard();
  } catch (e) {
    toast.error(errorMessage(e));
    return;
  }
  const data = new DataTransfer();
  if (clip.text) data.setData("text/plain", clip.text);
  if (clip.html) data.setData("text/html", clip.html);
  clip.images.forEach((pic, i) => {
    const ext = pic.type.split("/")[1] ?? "png";
    data.items.add(new File([bytes(pic.data)], `image-${i + 1}.${ext}`, { type: pic.type }));
  });
  refocus(t);
  const el = t.kind === "editor" ? t.view.contentDOM : t.el;
  const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
  if (!el.dispatchEvent(event) || !clip.text) return;
  // A field takes one line.
  const text = t.kind === "field" && t.el instanceof HTMLInputElement ? clip.text.replace(/\r?\n/g, " ") : clip.text.replace(/\r\n/g, "\n");
  document.execCommand("insertText", false, text);
}

function selectAll(t: TextTarget) {
  if (t.kind === "field") t.el.select();
  else if (t.kind === "editor") selectAllText(t.view);
  else document.execCommand("selectAll");
}

function textEntries(t: TextTarget): MenuEntries {
  const selected = selectedText(t) !== "";
  const canWrite = writable(t);
  const entries: MenuEntries = [];
  if (canWrite) {
    entries.push({ label: "剪切", icon: Scissors, shortcut: "Ctrl+X", disabled: !selected, run: () => cutOrCopy(t, "cut") });
  }
  entries.push({ label: "复制", icon: Copy, shortcut: "Ctrl+C", disabled: !selected, run: () => cutOrCopy(t, "copy") });
  if (canWrite) entries.push({ label: "粘贴", icon: ClipboardPaste, shortcut: "Ctrl+V", run: () => void paste(t) });
  entries.push(null, { label: "全选", icon: TextSelect, shortcut: "Ctrl+A", run: () => selectAll(t) });
  return entries;
}

/** The text selected outside fields, when the point x, y is on it. */
function selectionAt(x: number, y: number): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return "";
  const text = selection.toString();
  if (!text.trim()) return "";
  for (let i = 0; i < selection.rangeCount; i++) {
    for (const r of selection.getRangeAt(i).getClientRects()) {
      if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) return text;
    }
  }
  return "";
}

/** The menu, at the pointer; mounted once, in the main window. */
export function PageMenu() {
  const [menu, setMenu] = useState<(ShownMenu & { key: number }) | null>(null);
  const [open, setOpen] = useState(false);
  // The menu shown last: a menu closing as another opens leaves the keyboard alone.
  const shown = useRef(0);
  // The entry chosen, run once the menu has closed.
  const chosen = useRef<(() => void) | null>(null);
  const host = useRef<ReturnType<typeof hostPageMenu> | null>(null);

  useEffect(() => {
    const display = (m: ShownMenu) => {
      chosen.current = null;
      shown.current++;
      setMenu({ ...m, key: shown.current });
      setOpen(true);
    };
    host.current = hostPageMenu(display);
    // Fields first, before menus around them (a row being renamed) take the click.
    const onField = (e: MouseEvent) => {
      if (e.defaultPrevented || !(e.target instanceof Element) || e.target.closest("[data-own-menu]")) return;
      // A popover closes as the keyboard leaves it for the menu: its fields
      // keep the system's menu (app.go), which leaves the keyboard alone.
      if (e.target.closest("[data-radix-popper-content-wrapper]")) return;
      const t = textTarget(e.target);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      display({ x: e.clientX, y: e.clientY, entries: textEntries(t), restore: () => refocus(t) });
    };
    // Text selected elsewhere, where nothing else made a menu.
    const onSelection = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const text = selectionAt(e.clientX, e.clientY);
      if (!text) return;
      e.preventDefault();
      display({ x: e.clientX, y: e.clientY, entries: [{ label: "复制", icon: Copy, shortcut: "Ctrl+C", run: () => void copyText(text) }] });
    };
    window.addEventListener("contextmenu", onField, true);
    window.addEventListener("contextmenu", onSelection);
    return () => {
      window.removeEventListener("contextmenu", onField, true);
      window.removeEventListener("contextmenu", onSelection);
      host.current?.unhost();
      host.current = null;
    };
  }, []);

  useEffect(() => {
    host.current?.setOpen(open);
  }, [open]);

  if (!menu) return null;
  return (
    <DropdownMenu key={menu.key} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: menu.x, top: menu.y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-page-menu=""
        // Over the picture viewer too.
        className="z-[200] w-48"
        side="bottom"
        align="start"
        sideOffset={2}
        collisionPadding={8}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (menu.key !== shown.current) return;
          menu.restore?.();
          const run = chosen.current;
          chosen.current = null;
          run?.();
        }}
      >
        {menu.entries.map((entry, i) =>
          entry ? (
            <DropdownMenuItem
              key={i}
              disabled={entry.disabled}
              variant={entry.destructive ? "destructive" : "default"}
              onSelect={() => (chosen.current = entry.run)}
            >
              {entry.icon && <entry.icon />}
              {entry.label}
              {entry.shortcut && <DropdownMenuShortcut>{entry.shortcut}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSeparator key={i} />
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
