// The toolbar over a selection made with the mouse: the formats of
// format.ts, those the selection is in lit. It shows once the button is up
// and goes away as the user types, clicks elsewhere, leaves the editor or
// presses Escape.

import { type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import { type Command, EditorView, type Rect, showTooltip, type Tooltip, type TooltipView, tooltips } from "@codemirror/view";
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListTodo,
  type LucideIcon,
  Pilcrow,
  SquareCode,
  Strikethrough,
  TextQuote,
  Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type FormatState,
  formatState,
  setHeading,
  toggleCodeBlock,
  toggleInline,
  toggleLines,
  toggleLink,
} from "./format";

const setShown = StateEffect.define<boolean>();

const shown = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    let next = value;
    let told = false;
    for (const e of tr.effects) {
      if (e.is(setShown)) {
        next = e.value;
        told = true;
      }
    }
    if (tr.state.selection.main.empty) return false;
    if (told) return next;
    if (tr.docChanged && !tr.isUserEvent("input.format")) return false;
    return next;
  },
  provide: (field) =>
    showTooltip.compute([field, "selection"], (state): Tooltip | null =>
      state.field(field)
        ? { pos: state.selection.main.from, end: state.selection.main.to, above: true, create: createToolbar }
        : null,
    ),
});

/** Where the toolbar goes: centered over the selection's first line. */
function anchor(view: EditorView, dom: HTMLElement): Rect {
  const { from, to } = view.state.selection.main;
  const start = view.coordsAtPos(from, 1);
  const end = view.coordsAtPos(to, -1);
  if (!start) return { left: 0, right: 0, top: -1e4, bottom: -1e4 };
  const width = dom.offsetWidth;
  const oneLine = end && Math.abs(end.top - start.top) < 4;
  const mid = oneLine ? (start.left + end.right) / 2 : start.left + width / 2;
  return { left: mid - width / 2, right: mid + width / 2, top: start.top, bottom: end?.bottom ?? start.bottom };
}

/**
 * The room the toolbar has: the window across, and up and down the box
 * the editor scrolls in, so that it never floats over the panel's edge.
 */
function room(view: EditorView): Rect {
  const r = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const box = view.dom.closest(".scroller-viewport");
  if (box) {
    const b = box.getBoundingClientRect();
    r.top = Math.max(r.top, b.top);
    r.bottom = Math.min(r.bottom, b.bottom);
  }
  return r;
}

function createToolbar(view: EditorView): TooltipView {
  const dom = document.createElement("div");
  dom.className = "cm-format-toolbar";
  const root = createRoot(dom);
  const render = (state: EditorState) => root.render(<FormatToolbar view={view} format={formatState(state)} />);
  // Drawn at once, so that its size is known where it is placed.
  flushSync(() => render(view.state));
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    view.dispatch({ effects: setShown.of(false) });
  };
  return {
    dom,
    offset: { x: 0, y: 8 },
    getCoords: () => anchor(view, dom),
    mount() {
      // Before the page's own keys: in quick capture, Escape would leave the notes.
      window.addEventListener("keydown", onKey, true);
    },
    update(u) {
      if (u.docChanged || u.selectionSet) render(u.state);
    },
    destroy() {
      window.removeEventListener("keydown", onKey, true);
      queueMicrotask(() => root.unmount());
    },
  };
}

/** Shows the toolbar once the mouse has made a selection. */
const pointer = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0) return false;
    if (view.state.field(shown)) view.dispatch({ effects: setShown.of(false) });
    const up = () => {
      window.removeEventListener("mouseup", up, true);
      setTimeout(() => {
        if (view.dom.isConnected && view.hasFocus && !view.state.selection.main.empty) {
          view.dispatch({ effects: setShown.of(true) });
        }
      });
    };
    window.addEventListener("mouseup", up, true);
    return false;
  },
});

export const formatToolbar = [
  shown,
  pointer,
  EditorView.focusChangeEffect.of((state, focusing) => (!focusing && state.field(shown) ? setShown.of(false) : null)),
  // In the body: the panels clip, and frosted glass moves fixed elements.
  tooltips({ parent: document.body, tooltipSpace: room }),
];

const headings: { level: number; label: string; icon: LucideIcon; size: string }[] = [
  { level: 0, label: "正文", icon: Pilcrow, size: "text-sm" },
  { level: 1, label: "标题 1", icon: Heading1, size: "text-lg font-semibold" },
  { level: 2, label: "标题 2", icon: Heading2, size: "text-base font-semibold" },
  { level: 3, label: "标题 3", icon: Heading3, size: "text-sm font-semibold" },
];

function FormatToolbar({ view, format }: { view: EditorView; format: FormatState }) {
  const [picking, setPicking] = useState(false);
  const run = (command: Command) => {
    command(view);
    setPicking(false);
  };
  const current = headings.find((h) => h.level === format.heading) ?? headings[0]!;

  return (
    <div
      role="toolbar"
      aria-label="格式"
      className="format-toolbar relative flex items-center gap-0.5 rounded-xl border bg-popover p-1 text-popover-foreground"
      // Clicks keep the editor focused, and the selection.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={picking}
          className={cn("format-button w-auto gap-1 px-2", (picking || format.heading > 0) && "format-button-on")}
          onClick={() => setPicking((p) => !p)}
        >
          <current.icon className="size-4" />
          <span className="text-xs font-medium">{current.label}</span>
          <ChevronDown className={cn("size-3 opacity-60 transition-transform duration-200", picking && "rotate-180")} />
        </button>
        {picking && (
          <div role="menu" className="format-menu absolute left-0 flex w-36 flex-col gap-0.5 rounded-xl border bg-popover p-1">
            {headings.map((h) => (
              <button
                key={h.level}
                type="button"
                role="menuitemradio"
                aria-checked={h.level === format.heading}
                className="flex h-8 items-center gap-2 rounded-lg px-2 text-left transition-colors duration-150 hover:bg-accent"
                onClick={() => run(setHeading(h.level))}
              >
                <h.icon className="size-4 shrink-0 text-muted-foreground" />
                <span className={cn("flex-1 leading-none", h.size)}>{h.label}</span>
                {h.level === format.heading && <Check className="size-3.5 text-muted-foreground" />}
              </button>
            ))}
          </div>
        )}
      </div>
      <Divider />
      <FormatButton icon={Bold} label="粗体" keys="Ctrl+B" on={format.strong} onClick={() => run(toggleInline("strong"))} />
      <FormatButton icon={Italic} label="斜体" keys="Ctrl+I" on={format.em} onClick={() => run(toggleInline("em"))} />
      <FormatButton
        icon={Strikethrough}
        label="删除线"
        keys="Ctrl+Shift+X"
        on={format.strike}
        onClick={() => run(toggleInline("strike"))}
      />
      <FormatButton icon={Code} label="行内代码" keys="Ctrl+E" on={format.code} onClick={() => run(toggleInline("code"))} />
      <FormatButton
        icon={format.link ? Unlink : Link}
        label={format.link ? "取消链接" : "链接"}
        keys="Ctrl+K"
        on={format.link}
        onClick={() => run(toggleLink)}
      />
      <Divider />
      <FormatButton icon={TextQuote} label="引用" on={format.lines === "quote"} onClick={() => run(toggleLines("quote"))} />
      <FormatButton icon={List} label="列表" on={format.lines === "bullet"} onClick={() => run(toggleLines("bullet"))} />
      <FormatButton icon={ListTodo} label="任务" on={format.lines === "task"} onClick={() => run(toggleLines("task"))} />
      <FormatButton icon={SquareCode} label="代码块" on={format.codeBlock} onClick={() => run(toggleCodeBlock)} />
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />;
}

function FormatButton({
  icon: Icon,
  label,
  keys,
  on,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  keys?: string;
  on: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      className={cn("format-button group", on && "format-button-on")}
      onClick={onClick}
    >
      <Icon className="size-4" />
      <Hint>
        {label}
        {keys && <kbd className="font-sans text-[10px] opacity-60">{keys}</kbd>}
      </Hint>
    </button>
  );
}

/** The name of a button, shown a moment after the pointer rests on it. */
function Hint({ children }: { children: ReactNode }) {
  return (
    <span className="format-hint pointer-events-none absolute left-1/2 flex items-center gap-1.5 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background">
      {children}
    </span>
  );
}
