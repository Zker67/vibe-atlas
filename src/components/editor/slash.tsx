// The slash menu: a / typed at the start of a line or after a space opens
// it, the words typed after it narrow it down. ↑ ↓ pick, Enter or Tab run
// the one picked, Escape closes it and keeps the slash. It closes as the
// cursor leaves the slash's words, at a space, and with the editor's focus.

import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { syntaxTree } from "@codemirror/language";
import { type EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip, type TooltipView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import {
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  List,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  Minus,
  Pilcrow,
  SquareCode,
  Table,
  TextQuote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { choosePictures } from "./images";
import { matchSlash, type SlashCommand, type SlashId, slashEdit } from "./slash-commands";

const ICONS: Record<SlashId, LucideIcon> = {
  text: Pilcrow,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  bullet: List,
  numbered: ListOrdered,
  task: ListTodo,
  quote: TextQuote,
  code: SquareCode,
  table: Table,
  rule: Minus,
  image: ImagePlus,
};

interface Slash {
  /** Where the slash is. */
  from: number;
  /** The one picked, in the matches. */
  index: number;
}

const open = StateEffect.define<number>();
const close = StateEffect.define<null>();
const pick = StateEffect.define<number>();

const codeNodes = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText"]);

function inCode(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (codeNodes.has(node.name)) return true;
  }
  return false;
}

/** What is typed after the slash, while the cursor is in it. */
function queryOf(state: EditorState, slash: Slash): string | null {
  const { head, empty } = state.selection.main;
  if (!empty || head <= slash.from || state.sliceDoc(slash.from, slash.from + 1) !== "/") return null;
  const query = state.sliceDoc(slash.from + 1, head);
  if (/\s/.test(query) || query.length > 16) return null;
  return query;
}

const slashField = StateField.define<Slash | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(close)) return null;
      if (e.is(open)) return { from: e.value, index: 0 };
    }
    if (!value) return null;
    const next = { from: tr.changes.mapPos(value.from), index: value.index };
    for (const e of tr.effects) if (e.is(pick)) next.index = e.value;
    const query = queryOf(tr.state, next);
    if (query === null) return null;
    if (tr.docChanged) next.index = 0;
    return next;
  },
  provide: (field) =>
    showTooltip.compute([field], (state): Tooltip | null => {
      const slash = state.field(field);
      return slash ? { pos: slash.from, above: false, create: createMenu } : null;
    }),
});

/** Opens the menu as a slash is typed where one may start a command. */
const opener = EditorView.updateListener.of((u) => {
  if (!u.docChanged || u.state.field(slashField)) return;
  if (!u.transactions.some((tr) => tr.isUserEvent("input.type"))) return;
  const { head, empty } = u.state.selection.main;
  if (!empty || head === 0 || u.state.sliceDoc(head - 1, head) !== "/") return;
  const before = u.state.sliceDoc(head - 2, head - 1);
  if (before && !/\s/.test(before)) return;
  if (inCode(u.state, head - 1)) return;
  // Not within this update: after it.
  queueMicrotask(() => {
    if (u.view.state.selection.main.head === head) u.view.dispatch({ effects: open.of(head - 1) });
  });
});

function matches(state: EditorState): SlashCommand[] {
  const slash = state.field(slashField);
  return slash ? matchSlash(queryOf(state, slash) ?? "") : [];
}

/** Runs a command: the slash and its words make way for what it puts in. */
function run(view: EditorView, command: SlashCommand) {
  const slash = view.state.field(slashField);
  if (!slash) return;
  const from = slash.from;
  const to = view.state.selection.main.head;
  view.dispatch({ ...slashEdit(view.state, from, to, command.id), effects: close.of(null), scrollIntoView: true, userEvent: "input.format" });
  if (command.id === "image") choosePictures(view);
  view.focus();
}

function move(view: EditorView, delta: number): boolean {
  const slash = view.state.field(slashField);
  if (!slash) return false;
  const count = matches(view.state).length;
  if (count === 0) return true;
  view.dispatch({ effects: pick.of((slash.index + delta + count) % count) });
  return true;
}

function runPicked(view: EditorView): boolean {
  const slash = view.state.field(slashField);
  if (!slash) return false;
  const list = matches(view.state);
  const command = list[Math.min(slash.index, list.length - 1)];
  if (!command) {
    view.dispatch({ effects: close.of(null) });
    return false;
  }
  run(view, command);
  return true;
}

function createMenu(view: EditorView): TooltipView {
  const dom = document.createElement("div");
  dom.className = "cm-slash-menu";
  const root = createRoot(dom);
  const render = (state: EditorState) => {
    const slash = state.field(slashField);
    root.render(<SlashMenu list={matches(state)} index={slash?.index ?? 0} onRun={(c) => run(view, c)} />);
  };
  flushSync(() => render(view.state));
  // Before the page's and the dialog's own keys, which would close them.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    view.dispatch({ effects: close.of(null) });
  };
  return {
    dom,
    offset: { x: -4, y: 6 },
    mount() {
      window.addEventListener("keydown", onKey, true);
    },
    update(u) {
      if (u.docChanged || u.selectionSet || u.transactions.some((tr) => tr.effects.length > 0)) render(u.state);
    },
    destroy() {
      window.removeEventListener("keydown", onKey, true);
      queueMicrotask(() => root.unmount());
    },
  };
}

function SlashMenu({ list, index, onRun }: { list: SlashCommand[]; index: number; onRun(c: SlashCommand): void }) {
  return (
    <div
      role="listbox"
      aria-label="插入"
      className="slash-menu flex w-60 flex-col gap-0.5 rounded-xl border bg-popover p-1 text-popover-foreground"
      // Clicks keep the editor focused.
      onMouseDown={(e) => e.preventDefault()}
    >
      {list.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">没有匹配的命令</p>
      ) : (
        list.map((c, i) => {
          const Icon = ICONS[c.id];
          const on = i === Math.min(index, list.length - 1);
          return (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={on}
              ref={(el) => {
                if (on) el?.scrollIntoView({ block: "nearest" });
              }}
              className={cn("flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors duration-100", on && "bg-accent")}
              onClick={() => onRun(c)}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <Icon className="size-3.5" />
              </span>
              <span className="flex-1">{c.label}</span>
              <span className="font-mono text-[11px] text-muted-foreground/80">{c.hint}</span>
            </button>
          );
        })
      )}
    </div>
  );
}

export const slashMenu = [
  slashField,
  opener,
  EditorView.focusChangeEffect.of((state, focusing) => (!focusing && state.field(slashField) ? close.of(null) : null)),
  Prec.highest(
    keymap.of([
      { key: "ArrowDown", run: (v) => move(v, 1) },
      { key: "ArrowUp", run: (v) => move(v, -1) },
      { key: "Enter", run: runPicked },
      { key: "Tab", run: runPicked },
    ]),
  ),
];
