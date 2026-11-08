// Formatting commands of the Markdown editor, shared by its shortcuts and
// the toolbar over a selection. Each one toggles: a format the selection
// is in already comes off. They tell their transactions apart as
// "input.format", which keeps the toolbar open.

import { syntaxTree } from "@codemirror/language";
import { type ChangeSpec, EditorSelection, type EditorState, type Line, type SelectionRange } from "@codemirror/state";
import type { Command } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

export type InlineFormat = "strong" | "em" | "strike" | "code";
export type LineFormat = "quote" | "bullet" | "task";

const inlineSpecs: Record<InlineFormat, { node: string; mark: string; markNode: string }> = {
  strong: { node: "StrongEmphasis", mark: "**", markNode: "EmphasisMark" },
  em: { node: "Emphasis", mark: "*", markNode: "EmphasisMark" },
  strike: { node: "Strikethrough", mark: "~~", markNode: "StrikethroughMark" },
  code: { node: "InlineCode", mark: "`", markNode: "CodeMark" },
};

const userEvent = "input.format";

/** The innermost node named name around from–to, or null. */
function around(state: EditorState, from: number, to: number, name: string): SyntaxNode | null {
  const tree = syntaxTree(state);
  for (const [pos, side] of [
    [from, 1],
    [to, -1],
  ] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.name === name && node.from <= from && node.to >= to) return node;
    }
  }
  return null;
}

/** The lines a range touches: one ending at the start of a line leaves that line out. */
function linesOf(state: EditorState, range: SelectionRange): Line[] {
  const { doc } = state;
  const first = doc.lineAt(range.from);
  let last = doc.lineAt(range.to);
  if (!range.empty && last.number > first.number && range.to === last.from) last = doc.line(last.number - 1);
  const out: Line[] = [];
  for (let n = first.number; n <= last.number; n++) out.push(doc.line(n));
  return out;
}

/** Every line the selection touches, each once, in order: the ranges of a selection are. */
function selectedLines(state: EditorState): Line[] {
  const seen = new Map<number, Line>();
  for (const r of state.selection.ranges) for (const l of linesOf(state, r)) seen.set(l.number, l);
  return [...seen.values()];
}

/**
 * Toggles an inline format: inside it, the marks of the whole run come
 * off; otherwise the selection, without the spaces around it, gets them,
 * line by line. An empty selection gets a pair to type between.
 */
export function toggleInline(format: InlineFormat): Command {
  const spec = inlineSpecs[format];
  return (view) => {
    const { state } = view;
    const tr = state.changeByRange((range) => {
      const node = around(state, range.from, range.to, spec.node);
      const open = node?.firstChild;
      const close = node?.lastChild;
      if (node && open && close && open !== close && open.name === spec.markNode && close.name === spec.markNode) {
        const changes = state.changes([
          { from: open.from, to: open.to },
          { from: close.from, to: close.to },
        ]);
        return { changes, range: range.map(changes) };
      }
      if (range.empty) {
        return {
          changes: { from: range.from, insert: spec.mark + spec.mark },
          range: EditorSelection.cursor(range.from + spec.mark.length),
        };
      }
      const specs: ChangeSpec[] = [];
      for (const line of linesOf(state, range)) {
        const from = Math.max(range.from, line.from);
        const to = Math.min(range.to, line.to);
        const text = state.sliceDoc(from, to);
        const start = from + (text.length - text.trimStart().length);
        const end = to - (text.length - text.trimEnd().length);
        if (end <= start) continue;
        specs.push({ from: start, insert: spec.mark }, { from: end, insert: spec.mark });
      }
      // The selection keeps to the text, inside the new marks.
      const changes = state.changes(specs);
      const forward = range.anchor <= range.head;
      return {
        changes,
        range: EditorSelection.range(changes.mapPos(range.anchor, forward ? 1 : -1), changes.mapPos(range.head, forward ? -1 : 1)),
      };
    });
    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent }));
    return true;
  };
}

/**
 * Toggles a link: in one, it becomes its text again; otherwise the
 * selection becomes the text of a new link, whose address is selected to
 * type or paste.
 */
export const toggleLink: Command = (view) => {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const node = around(state, range.from, range.to, "Link");
    const marks = node?.getChildren("LinkMark") ?? [];
    if (node && marks.length >= 2 && marks[0]!.to <= marks[1]!.from) {
      const text = state.sliceDoc(marks[0]!.to, marks[1]!.from);
      return {
        changes: { from: node.from, to: node.to, insert: text },
        range: EditorSelection.range(node.from, node.from + text.length),
      };
    }
    const text = state.sliceDoc(range.from, range.to) || "链接";
    const urlFrom = range.from + text.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert: `[${text}](url)` },
      range: EditorSelection.range(urlFrom, urlFrom + 3),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent }));
  return true;
};

const headingMark = /^#{1,6}[ \t]+/;
const quoteMark = /^>[ \t]?/;
const listMark = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/;

/** Changes the start of each line the selection touches, keeping the selection on the same text. */
function editLines(edit: (line: Line) => ChangeSpec | null): Command {
  return (view) => {
    const { state } = view;
    const specs: ChangeSpec[] = [];
    for (const line of selectedLines(state)) {
      const spec = edit(line);
      if (spec) specs.push(spec);
    }
    if (specs.length === 0) return true;
    const changes = state.changes(specs);
    view.dispatch({
      changes,
      selection: state.selection.map(changes, 1),
      scrollIntoView: true,
      userEvent,
    });
    return true;
  };
}

/** Makes the lines headings of level (1–6), or plain text for 0. */
export function setHeading(level: number): Command {
  const mark = level > 0 ? "#".repeat(level) + " " : "";
  return editLines((line) => {
    if (!line.text.trim()) return null;
    const old = headingMark.exec(line.text)?.[0] ?? "";
    if (old === mark) return null;
    return { from: line.from, to: line.from + old.length, insert: mark };
  });
}

function lineFormat(text: string): LineFormat | "numbered" | null {
  if (quoteMark.test(text)) return "quote";
  const list = listMark.exec(text);
  if (!list) return null;
  if (list[3]) return "task";
  return /\d/.test(list[2]!) ? "numbered" : "bullet";
}

/**
 * Toggles quotes, bullets or tasks on the lines: when every line has it
 * already, it comes off; otherwise every line gets it, a list mark of
 * another kind giving way.
 */
export function toggleLines(format: LineFormat): Command {
  return (view) => {
    const lines = selectedLines(view.state).filter((l) => l.text.trim());
    const all = lines.length > 0 && lines.every((l) => lineFormat(l.text) === format);
    return editLines((line) => {
      if (format !== "quote" && !line.text.trim()) return null;
      if (format === "quote") {
        const old = quoteMark.exec(line.text)?.[0];
        if (all) return old ? { from: line.from, to: line.from + old.length } : null;
        if (old) return null;
        return { from: line.from, insert: line.text.trim() ? "> " : ">" };
      }
      const list = listMark.exec(line.text);
      const indent = list?.[1] ?? /^[ \t]*/.exec(line.text)![0];
      const oldEnd = line.from + (list ? list[0].length : indent.length);
      if (all) return { from: line.from + indent.length, to: oldEnd };
      if (lineFormat(line.text) === format) return null;
      return { from: line.from + indent.length, to: oldEnd, insert: format === "task" ? "- [ ] " : "- " };
    })(view);
  };
}

const fenceLine = /^[ \t]*(`{3,}|~{3,})/;

/** Puts the lines in a fenced code block, or takes the block's fences off. */
export const toggleCodeBlock: Command = (view) => {
  const { state } = view;
  const { doc } = state;
  const main = state.selection.main;
  const block = around(state, main.from, main.to, "FencedCode");
  if (block) {
    const first = doc.lineAt(block.from);
    const last = doc.lineAt(block.to);
    const specs: ChangeSpec[] = [{ from: first.from, to: Math.min(first.to + 1, doc.length) }];
    if (last.number > first.number && fenceLine.test(last.text)) specs.push({ from: last.from - 1, to: last.to });
    const changes = state.changes(specs);
    view.dispatch({ changes, selection: state.selection.map(changes), scrollIntoView: true, userEvent });
    return true;
  }
  const lines = linesOf(state, main);
  const first = lines[0]!;
  const last = lines[lines.length - 1]!;
  view.dispatch({
    changes: [
      { from: first.from, insert: "```\n" },
      { from: last.to, insert: "\n```" },
    ],
    selection: EditorSelection.range(main.anchor + 4, main.head + 4),
    scrollIntoView: true,
    userEvent,
  });
  return true;
};

export interface FormatState {
  strong: boolean;
  em: boolean;
  strike: boolean;
  code: boolean;
  link: boolean;
  /** The heading level of the first line, 0 for plain text. */
  heading: number;
  /** The format all the lines share, if any. */
  lines: LineFormat | null;
  codeBlock: boolean;
}

/** Which formats the main selection is in, to light them up. */
export function formatState(state: EditorState): FormatState {
  const { from, to } = state.selection.main;
  const lines = linesOf(state, state.selection.main);
  const kinds = new Set(lines.filter((l) => l.text.trim()).map((l) => lineFormat(l.text)));
  return {
    strong: !!around(state, from, to, "StrongEmphasis"),
    em: !!around(state, from, to, "Emphasis"),
    strike: !!around(state, from, to, "Strikethrough"),
    code: !!around(state, from, to, "InlineCode"),
    link: !!around(state, from, to, "Link"),
    heading: headingMark.exec(lines[0]!.text)?.[0].trim().length ?? 0,
    lines: kinds.size === 1 && !kinds.has("numbered") ? ([...kinds][0] as LineFormat | null) : null,
    codeBlock: !!around(state, from, to, "FencedCode"),
  };
}
