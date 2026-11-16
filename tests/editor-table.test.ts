// Tables in the Markdown editor (src/components/editor/table-model.ts), on a
// real CodeMirror state with the real Markdown parser: reading their cells,
// lining up their columns, and what Tab, Shift+Tab and Enter do in them.
// Tables are full of |, so ‸ marks the cursor here and « » a selection.

import { expect, test } from "bun:test";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import {
  displayWidth,
  formatRows,
  nextCell,
  splitRow,
  tableAt,
  tableEnter,
  tablesIn,
} from "../src/components/editor/table-model";

/** A state with ‸ for the cursor, or « » around the selection. */
function state(marked: string): EditorState {
  let anchor = marked.indexOf("«");
  let head: number;
  let doc: string;
  if (anchor >= 0) {
    head = marked.indexOf("»") - 1;
    doc = marked.replace("«", "").replace("»", "");
  } else {
    anchor = head = marked.indexOf("‸");
    doc = marked.replace("‸", "");
  }
  const s = EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
}

/** The text after spec, its selection marked as state() takes it. */
function after(s: EditorState, spec: TransactionSpec | null): string {
  expect(spec).not.toBeNull();
  const next = s.update(spec!).state;
  const { from, to, empty } = next.selection.main;
  const d = next.doc.toString();
  return empty ? d.slice(0, from) + "‸" + d.slice(from) : d.slice(0, from) + "«" + d.slice(from, to) + "»" + d.slice(to);
}

const cells = (text: string) => splitRow(text).map((c) => text.slice(c.from, c.to));

test("splitRow: with and without the outer pipes, escaped pipes, empty cells", () => {
  expect(cells("| a | b |")).toEqual(["a", "b"]);
  expect(cells("a | b")).toEqual(["a", "b"]);
  expect(cells("| a \\| b | c |")).toEqual(["a \\| b", "c"]);
  expect(cells("|  | x |")).toEqual(["", "x"]);
  expect(cells("no pipes")).toEqual([]);
});

test("tableAt reads the rows, the delimiter and the alignments", () => {
  const s = state("前面‸\n\n| 名 | 值 | 说明 |\n| :-- | --: | :-: |\n| a | 1 | x|\n\n后面");
  const t = tableAt(s, s.doc.toString().indexOf("1 |"))!;
  expect(t).not.toBeNull();
  expect(t.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
    ["名", "值", "说明"],
    [":--", "--:", ":-:"],
    ["a", "1", "x"],
  ]);
  expect(t.rows[1]!.delimiter).toBe(true);
  expect(t.aligns).toEqual(["left", "right", "center"]);
  expect(s.sliceDoc(t.from, t.to)).toBe("| 名 | 值 | 说明 |\n| :-- | --: | :-: |\n| a | 1 | x|");
  expect(tableAt(s, 1)).toBeNull();
  expect(tablesIn(s)).toHaveLength(1);
});

test("a table in code is no table", () => {
  const s = state("‸```\n| a | b |\n| - | - |\n```");
  expect(tablesIn(s)).toHaveLength(0);
});

test("displayWidth counts Chinese and emoji as two", () => {
  expect(displayWidth("abc")).toBe(3);
  expect(displayWidth("中文")).toBe(4);
  expect(displayWidth("a😀")).toBe(3);
  expect(displayWidth("ｱ")).toBe(1);
});

test("formatRows lines the columns up, Chinese as two wide", () => {
  expect(formatRows([["名称", "n"], ["a", "很长的值"]], ["", "right"])).toBe(
    "| 名称 |        n |\n| ---- | -------: |\n| a    | 很长的值 |",
  );
  expect(formatRows([["a"], ["b"]], ["center"])).toBe("|  a  |\n| :-: |\n|  b  |");
  expect(formatRows([["x", "y"]], ["left", ""], "> ")).toBe("> | x   | y   |\n> | :-- | --- |");
});

test("Tab lines up the table and selects the next cell", () => {
  const s = state("| 名 | 值 |\n| --- | --- |\n| a‸| 1 |\n");
  expect(after(s, nextCell(s, 1))).toBe("| 名  | 值  |\n| --- | --- |\n| a   | «1»   |\n");
});

test("Tab from the last cell of a row goes to the next row, from the last of all adds one", () => {
  const header = state("| a | b‸ |\n| --- | --- |\n| 1 | 2 |");
  expect(after(header, nextCell(header, 1))).toBe("| a   | b   |\n| --- | --- |\n| «1»   | 2   |");
  const last = state("| a | b |\n| --- | --- |\n| 1 | 2‸ |");
  expect(after(last, nextCell(last, 1))).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| ‸    |     |");
});

test("Shift+Tab goes back a cell, and stays at the first", () => {
  const s = state("| a | b |\n| --- | --- |\n| 1 | ‸2 |");
  expect(after(s, nextCell(s, -1))).toBe("| a   | b   |\n| --- | --- |\n| «1»   | 2   |");
  const first = state("| ‸a | b |\n| --- | --- |");
  expect(after(first, nextCell(first, -1))).toBe("| «a»   | b   |\n| --- | --- |");
});

test("Enter at the end of a row adds an empty row under it", () => {
  const s = state("| a | b |\n| --- | --- |\n| 1 | 2 |‸\n| 3 | 4 |");
  expect(after(s, tableEnter(s))).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| ‸    |     |\n| 3   | 4   |");
});

test("Enter in an empty last row leaves the table", () => {
  const s = state("| a | b |\n| --- | --- |\n| 1 | 2 |\n|   |   |‸");
  expect(after(s, tableEnter(s))).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n‸");
});

test("Enter in the middle of a cell is left to the editor", () => {
  const s = state("| a | b |\n| --- | --- |\n| 1‸ | 2 |");
  expect(tableEnter(s)).toBeNull();
  const out = state("段落‸");
  expect(tableEnter(out)).toBeNull();
  expect(nextCell(out, 1)).toBeNull();
});
