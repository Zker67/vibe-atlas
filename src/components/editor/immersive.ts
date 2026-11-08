// What the Markdown editor does only in the immersive dialog: focus mode,
// which dims all but the paragraph being written; typewriter scrolling,
// which keeps the line being written in the middle; folding of sections;
// and what the dialog shows around the text: its outline and its counts.

import { foldGutter, foldKeymap, syntaxTree } from "@codemirror/language";
import { EditorState, type Extension, type Range, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

export interface ImmersiveOptions {
  focus: boolean;
  typewriter: boolean;
}

// ---- Focus mode ----

const dimmed = Decoration.line({ class: "cm-dimmed" });

/** The lines of the paragraph the cursor is in: up and down to blank lines, or the code block around it. */
function paragraphAt(state: EditorState): [number, number] {
  const { doc } = state;
  const head = state.selection.main.head;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(head, -1); node; node = node.parent) {
    if (node.name === "FencedCode") return [doc.lineAt(node.from).number, doc.lineAt(node.to).number];
  }
  const at = doc.lineAt(head).number;
  let first = at;
  let last = at;
  if (doc.line(at).text.trim()) {
    while (first > 1 && doc.line(first - 1).text.trim()) first--;
    while (last < doc.lines && doc.line(last + 1).text.trim()) last++;
  }
  return [first, last];
}

function dim(view: EditorView): DecorationSet {
  if (!view.hasFocus) return Decoration.none;
  const [first, last] = paragraphAt(view.state);
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      if (line.number < first || line.number > last) out.push(dimmed.range(line.from));
      pos = line.to + 1;
    }
  }
  return Decoration.set(out);
}

const focusMode = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = dim(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged) this.decorations = dim(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// ---- Typewriter scrolling ----

/** Typing and moving by keys keep the cursor's line in the middle; the pointer leaves it where it is. */
const typewriter = EditorState.transactionExtender.of((tr) => {
  if (!tr.selection && !tr.docChanged) return null;
  const byKeys = tr.isUserEvent("input") || tr.isUserEvent("delete") || (tr.isUserEvent("select") && !tr.isUserEvent("select.pointer"));
  if (!byKeys) return null;
  return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: "center" }) };
});

// ---- Folding ----

function chevron(open: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = "cm-fold-chevron" + (open ? "" : " cm-fold-chevron-closed");
  el.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  el.title = open ? "收起这一节" : "展开这一节";
  return el;
}

/** The extensions of the immersive dialog, for the options on. */
export function immersiveExtensions(options: ImmersiveOptions): Extension {
  return [
    foldGutter({ markerDOM: chevron }),
    keymap.of(foldKeymap),
    EditorView.editorAttributes.of({ class: "cm-immersive" + (options.typewriter ? " cm-typewriter" : "") }),
    options.focus ? focusMode : [],
    options.typewriter ? typewriter : [],
  ];
}

// ---- Outline and counts ----

export interface Heading {
  level: number;
  text: string;
  /** Where its line starts. */
  from: number;
}

/** The headings of the text, in order. */
export function headingsIn(state: EditorState): Heading[] {
  const out: Heading[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      const m = /^(?:ATXHeading([1-6])|SetextHeading([12]))$/.exec(node.name);
      if (!m) return;
      const line = state.doc.lineAt(node.from);
      const text = (m[1] ? line.text.replace(/^\s*#{1,6}\s*/, "").replace(/\s+#+\s*$/, "") : line.text).trim();
      if (text) out.push({ level: Number(m[1] ?? m[2]), text, from: line.from });
      return false;
    },
  });
  return out;
}

/** The heading the cursor is under: the last one at or before it, or -1. */
export function currentHeading(headings: Heading[], pos: number): number {
  let at = -1;
  for (let i = 0; i < headings.length && headings[i]!.from <= pos; i++) at = i;
  return at;
}

export interface Counts {
  /** Chinese characters, each a word, and words of other scripts. */
  words: number;
  lines: number;
  /** Minutes to read it, at least one once there is text. */
  minutes: number;
}

/** How long the text is, its Markdown marks and the addresses of its links and pictures not counted. */
export function countText(doc: Text): Counts {
  const text = doc
    .toString()
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, " ")
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/[#>*_~`|[\]()-]/g, " ");
  const han = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const other = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ").match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  const words = han + other;
  // About 400 Chinese characters a minute, 200 words of other scripts.
  const minutes = words === 0 ? 0 : Math.max(1, Math.round(han / 400 + other / 200));
  return { words, lines: doc.lines, minutes };
}
