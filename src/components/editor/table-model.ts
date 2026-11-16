// GFM tables in the Markdown editor, as text: their rows and cells, lining
// up their columns, and the commands of Tab, Shift+Tab and Enter in them.
// No DOM: tables.ts shows them, tests run these on real CodeMirror states.

import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import type { Command } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

export type Align = "" | "left" | "center" | "right";

/** A cell: where its text is, without the spaces around it; empty, a place to type. */
export interface Cell {
  from: number;
  to: number;
  text: string;
  /** Where the cell begins, after the pipe before it. */
  start: number;
}

export interface Row {
  from: number;
  to: number;
  cells: Cell[];
  /** The row of dashes under the header. */
  delimiter: boolean;
}

export interface Table {
  from: number;
  to: number;
  /** What each line starts with before the table: indentation, quote marks. */
  prefix: string;
  rows: Row[];
  aligns: Align[];
}

const prefixPattern = /^(?:\s*>)*\s*/;

/** The cells of a row's text, after its prefix; offsets in text. */
export function splitRow(text: string, start = 0): { from: number; to: number; start: number }[] {
  const pipes: number[] = [];
  for (let i = start; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "|") pipes.push(i);
  }
  if (pipes.length === 0) return [];
  const lead = text.slice(start, pipes[0]).trim() === "";
  const trail = text.slice(pipes[pipes.length - 1]! + 1).trim() === "";
  const bounds = [...(lead ? [] : [start - 1]), ...pipes, ...(trail ? [] : [text.length])];
  const cells: { from: number; to: number; start: number }[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const begin = bounds[k]! + 1;
    const end = bounds[k + 1]!;
    let s = begin;
    let e = end;
    while (s < e && /\s/.test(text[s]!)) s++;
    while (e > s && /\s/.test(text[e - 1]!)) e--;
    if (s === e) s = e = Math.min(begin + 1, end);
    cells.push({ from: s, to: e, start: begin });
  }
  return cells;
}

function alignOf(text: string): Align {
  const t = text.trim();
  const left = t.startsWith(":");
  const right = t.endsWith(":") && t.length > 1;
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "";
}

/** The table in text, its first character at base in the document. */
export function readTable(text: string, base: number): Table {
  const lines = text.split("\n");
  const prefix = prefixPattern.exec(lines[0]!)![0];
  const rows: Row[] = [];
  let at = base;
  lines.forEach((line, i) => {
    const start = Math.min(prefixPattern.exec(line)![0].length, line.length);
    const cells = splitRow(line, start).map((c) => ({
      from: at + c.from,
      to: at + c.to,
      start: at + c.start,
      text: line.slice(c.from, c.to),
    }));
    rows.push({ from: at, to: at + line.length, cells, delimiter: i === 1 });
    at += line.length + 1;
  });
  const aligns = rows[1] ? rows[1].cells.map((c) => alignOf(c.text)) : [];
  return { from: base, to: base + text.length, prefix, rows, aligns };
}

function tableNode(state: EditorState, pos: number): SyntaxNode | null {
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); node; node = node.parent) {
      if (node.name === "Table") return node;
    }
  }
  return null;
}

/** The table pos is in, from the start of its first line to the end of its last. */
export function tableAt(state: EditorState, pos: number): Table | null {
  const node = tableNode(state, pos);
  if (!node) return null;
  const from = state.doc.lineAt(node.from).from;
  const to = state.doc.lineAt(node.to).to;
  return readTable(state.sliceDoc(from, to), from);
}

/** The tables of the document, in order. */
export function tablesIn(state: EditorState): Table[] {
  const out: Table[] = [];
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== "Table") return;
      const from = state.doc.lineAt(ref.from).from;
      const to = state.doc.lineAt(ref.to).to;
      out.push(readTable(state.sliceDoc(from, to), from));
      return false;
    },
  });
  return out;
}

/** How wide text shows in a monospace font: the wide characters of Chinese, Japanese and Korean, and emoji, take two. */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff) ||
      (c >= 0x20000 && c <= 0x3fffd);
    w += wide ? 2 : 1;
  }
  return w;
}

function pad(text: string, width: number, align: Align): string {
  const room = Math.max(0, width - displayWidth(text));
  if (align === "right") return " ".repeat(room) + text;
  if (align === "center") return " ".repeat(Math.floor(room / 2)) + text + " ".repeat(Math.ceil(room / 2));
  return text + " ".repeat(room);
}

function dashes(width: number, align: Align): string {
  if (align === "center") return ":" + "-".repeat(Math.max(1, width - 2)) + ":";
  if (align === "left") return ":" + "-".repeat(Math.max(2, width - 1));
  if (align === "right") return "-".repeat(Math.max(2, width - 1)) + ":";
  return "-".repeat(Math.max(3, width));
}

/** The text of a table with these cells (the delimiter row left out), its columns lined up. */
export function formatRows(cells: string[][], aligns: Align[], prefix = ""): string {
  const columns = Math.max(aligns.length, ...cells.map((r) => r.length), 1);
  const widths = Array.from({ length: columns }, (_, c) => Math.max(3, ...cells.map((r) => displayWidth(r[c] ?? ""))));
  const line = (parts: string[]) => `${prefix}| ${parts.join(" | ")} |`;
  const out = cells.map((r) => line(widths.map((w, c) => pad(r[c] ?? "", w, aligns[c] ?? ""))));
  out.splice(1, 0, line(widths.map((w, c) => dashes(w, aligns[c] ?? ""))));
  return out.join("\n");
}

/** The cells of the table's rows but the delimiter's. */
function cellTexts(t: Table): string[][] {
  return t.rows.filter((r) => !r.delimiter).map((r) => r.cells.map((c) => c.text));
}

/** The row and column of the cell pos is in: of the rows but the delimiter's. */
export function cellAt(t: Table, pos: number): { row: number; col: number } | null {
  let row = -1;
  for (const r of t.rows) {
    if (!r.delimiter) row++;
    if (pos < r.from || pos > r.to) continue;
    if (r.delimiter) return { row: 0, col: Math.max(0, cellIndex(r, pos)) };
    return { row, col: Math.max(0, cellIndex(r, pos)) };
  }
  return null;
}

/** The cell of r that pos is in: each takes from just after the pipe before it. */
function cellIndex(r: Row, pos: number): number {
  for (let i = r.cells.length - 1; i >= 0; i--) {
    if (pos >= r.cells[i]!.start) return i;
  }
  return 0;
}

/** The table cells make, lined up, put in place of t, with the cell row, col selected. */
function retable(state: EditorState, t: Table, cells: string[][], row: number, col: number): TransactionSpec {
  const text = formatRows(cells, t.aligns, t.prefix);
  const laid = readTable(text, t.from);
  const body = laid.rows.filter((r) => !r.delimiter);
  const cell = body[row]?.cells[col] ?? body[row]?.cells[0];
  const sel = cell ? EditorSelection.range(cell.from, cell.to) : EditorSelection.cursor(t.from);
  return {
    changes: { from: t.from, to: t.to, insert: text },
    selection: sel,
    scrollIntoView: true,
    userEvent: "input",
  };
}

/** Tab in a table: lines it up and goes to the next cell, adding a row after the last. */
export function nextCell(state: EditorState, dir: 1 | -1): TransactionSpec | null {
  const pos = state.selection.main.head;
  const t = tableAt(state, pos);
  const at = t && cellAt(t, pos);
  if (!t || !at) return null;
  const cells = cellTexts(t);
  const columns = Math.max(t.aligns.length, ...cells.map((r) => r.length));
  let { row, col } = at;
  col += dir;
  if (col >= columns) {
    row++;
    col = 0;
  } else if (col < 0) {
    row--;
    col = columns - 1;
  }
  if (row < 0) {
    row = 0;
    col = 0;
  }
  if (row >= cells.length) cells.push(Array(columns).fill(""));
  return retable(state, t, cells, row, col);
}

/** Enter at the end of a row: a row like it under it; in an empty last row, out of the table. */
export function tableEnter(state: EditorState): TransactionSpec | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const t = tableAt(state, sel.head);
  const at = t && cellAt(t, sel.head);
  if (!t || !at) return null;
  const line = state.doc.lineAt(sel.head);
  if (state.sliceDoc(sel.head, line.to).trim() !== "" && state.sliceDoc(sel.head, line.to).trim() !== "|") return null;
  const cells = cellTexts(t);
  const isDelimiter = t.rows[1] && line.from === t.rows[1].from;
  const row = isDelimiter ? 0 : at.row;
  const last = row === cells.length - 1;
  if (row > 0 && last && cells[row]!.every((c) => c.trim() === "")) {
    // An empty row at the end: it goes, and the cursor leaves the table.
    return { changes: { from: line.from, to: line.to, insert: "" }, selection: { anchor: line.from }, userEvent: "input" };
  }
  const columns = Math.max(t.aligns.length, ...cells.map((r) => r.length));
  cells.splice(row + 1, 0, Array(columns).fill(""));
  return retable(state, t, cells, row + 1, 0);
}

const run =
  (spec: (state: EditorState) => TransactionSpec | null): Command =>
  (view) => {
    const s = spec(view.state);
    if (!s) return false;
    view.dispatch(s);
    return true;
  };

export const tableTab = run((s) => nextCell(s, 1));
export const tableShiftTab = run((s) => nextCell(s, -1));
export const tableNewRow = run(tableEnter);
