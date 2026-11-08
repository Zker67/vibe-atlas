// The commands of the slash menu (slash.tsx), apart from its view: what
// each does to the text, and which match what is typed after the slash.

import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";

export type SlashId =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "numbered"
  | "task"
  | "quote"
  | "code"
  | "table"
  | "rule"
  | "image";

export interface SlashCommand {
  id: SlashId;
  label: string;
  hint: string;
  /** What else finds it: English, and the pinyin of its name, in full and by initials. */
  keys: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "text", label: "正文", hint: "普通段落", keys: "text paragraph p zhengwen zw" },
  { id: "h1", label: "标题 1", hint: "#", keys: "h1 heading title biaoti bt" },
  { id: "h2", label: "标题 2", hint: "##", keys: "h2 heading title biaoti bt" },
  { id: "h3", label: "标题 3", hint: "###", keys: "h3 heading title biaoti bt" },
  { id: "bullet", label: "列表", hint: "-", keys: "list bullet ul liebiao lb" },
  { id: "numbered", label: "编号列表", hint: "1.", keys: "numbered ordered ol list bianhao bh liebiao" },
  { id: "task", label: "任务", hint: "- [ ]", keys: "task todo check renwu rw" },
  { id: "quote", label: "引用", hint: ">", keys: "quote blockquote yinyong yy" },
  { id: "code", label: "代码块", hint: "```", keys: "code block fence daima dmk" },
  { id: "table", label: "表格", hint: "| |", keys: "table biaoge bg" },
  { id: "rule", label: "分隔线", hint: "---", keys: "rule divider hr line fengexian fgx" },
  { id: "image", label: "图片", hint: "从文件选择", keys: "image picture img tupian tp" },
];

/** The commands matching what is typed after the slash, in the menu's order. */
export function matchSlash(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) => c.label.toLowerCase().replace(/\s+/g, "").includes(q.replace(/\s+/g, "")) || c.keys.split(" ").some((k) => k.startsWith(q)),
  );
}

const LINE_MARKS: Partial<Record<SlashId, string>> = {
  text: "",
  h1: "# ",
  h2: "## ",
  h3: "### ",
  bullet: "- ",
  numbered: "1. ",
  task: "- [ ] ",
  quote: "> ",
};

/** The mark a line starts with: a heading's, a quote's or a list item's, after its indent. */
const startMark = /^([ \t]*)(#{1,6}[ \t]+|>[ \t]?|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/;

/**
 * What a command does to the text, the slash and what follows it at
 * from–to taken out: a line format goes on the line, a block goes in its
 * place on an empty line and under the line otherwise. The image command
 * only takes the slash out; the menu then asks for the files.
 */
export function slashEdit(state: EditorState, from: number, to: number, id: SlashId): TransactionSpec {
  const line = state.doc.lineAt(from);
  const mark = LINE_MARKS[id];
  if (mark !== undefined) {
    const m = startMark.exec(line.text)!;
    const indent = m[1]!;
    const old = m[2] ?? "";
    const markFrom = line.from + indent.length;
    const markTo = markFrom + old.length;
    // The slash is after the old mark: the two changes do not overlap.
    return {
      changes: [
        { from: markFrom, to: markTo, insert: mark },
        { from, to },
      ],
      selection: EditorSelection.cursor(from - old.length + mark.length),
    };
  }
  const rest = state.sliceDoc(line.from, from) + state.sliceDoc(to, line.to);
  const empty = rest.trim() === "";
  let block = "";
  let cursor = 0; // in block
  let select = 0; // characters selected from the cursor
  switch (id) {
    case "code":
      block = "```\n\n```";
      cursor = 4;
      break;
    case "table":
      block = "| 列 1 | 列 2 |\n| --- | --- |\n|  |  |";
      cursor = 2;
      select = 3;
      break;
    case "rule":
      block = "---\n";
      cursor = block.length;
      break;
    case "image":
      return { changes: { from, to }, selection: EditorSelection.cursor(from) };
  }
  if (empty) {
    const at = line.from + cursor;
    return {
      changes: { from: line.from, to: line.to, insert: block },
      selection: EditorSelection.range(at, at + select),
    };
  }
  // Under the line, the slash taken out of it.
  const lineEnd = line.to - (to - from);
  const at = lineEnd + 1 + cursor;
  return {
    changes: [
      { from, to },
      { from: line.to, insert: "\n" + block },
    ],
    selection: EditorSelection.range(at, at + select),
  };
}
