// Typing helps of the Markdown editor, on a real CodeMirror state with the
// real Markdown parser: pairs of marks (src/components/editor/autopair.ts),
// the slash menu's commands (slash-commands.ts), and the outline and counts
// of the immersive dialog (immersive.ts).

import { expect, test } from "bun:test";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { deletePair, pairInput } from "../src/components/editor/autopair";
import { countText, currentHeading, headingsIn } from "../src/components/editor/immersive";
import { matchSlash, slashEdit } from "../src/components/editor/slash-commands";

/** A state with its selection marked: « and » around it, or | for a cursor. */
function state(text: string): EditorState {
  let anchor = text.indexOf("«");
  let head: number;
  let doc: string;
  if (anchor >= 0) {
    head = text.indexOf("»") - 1;
    doc = text.replace("«", "").replace("»", "");
  } else {
    anchor = head = text.indexOf("|");
    doc = text.replace("|", "");
  }
  const s = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
}

/** The text of a state with its selection marked, as state() takes it. */
function marked(s: EditorState): string {
  const { from, to, empty } = s.selection.main;
  const d = s.doc.toString();
  return empty ? d.slice(0, from) + "|" + d.slice(from) : d.slice(0, from) + "«" + d.slice(from, to) + "»" + d.slice(to);
}

/** Types text with pairs: what the editor shows after, or null when it types as ever. */
function type(text: string, ch: string): string | null {
  const s = state(text);
  const { from, to } = s.selection.main;
  const spec = pairInput(s, from, to, ch);
  return spec ? marked(s.update(spec).state) : null;
}

const apply = (s: EditorState, spec: TransactionSpec | null) => (spec ? marked(s.update(spec).state) : null);

// ---- Pairs ----

test("an opening mark adds its closing one", () => {
  expect(type("|", "(")).toBe("(|)");
  expect(type("say |", "[")).toBe("say [|]");
  expect(type("a |b", "(")).toBeNull(); // before a word: typed as ever
  expect(type("|。", "(")).toBe("(|)。");
});

test("the closing mark steps over the one there", () => {
  expect(type("(|)", ")")).toBe("()|");
  expect(type("- [ |]", "]")).toBe("- [ ]|");
});

test("quotes and backticks after a word are not opening ones", () => {
  expect(type("don|", '"')).toBeNull();
  expect(type("中文|", "`")).toBeNull();
  expect(type("see |", "`")).toBe("see `|`");
});

test("three backticks make a fence, not two pairs", () => {
  let s = "|";
  for (const _ of [1, 2, 3]) {
    const st = state(s);
    const { from, to } = st.selection.main;
    const spec = pairInput(st, from, to, "`");
    s = spec ? marked(st.update(spec).state) : marked(st.update({ changes: { from, to, insert: "`" }, selection: { anchor: from + 1 } }).state);
  }
  expect(s).toBe("```|");
});

test("a selection is wrapped, and stays on its text", () => {
  expect(type("say «hi»", "(")).toBe("say («hi»)");
  expect(type("say «hi»", "*")).toBe("say *«hi»*");
  expect(type("say «hi»", "~")).toBe("say ~«hi»~");
  expect(type("say «hi»", "a")).toBeNull();
});

test("Backspace between an empty pair takes both", () => {
  expect(apply(state("x(|)"), deletePair(state("x(|)")))).toBe("x|");
  expect(deletePair(state("x(a|)"))).toBeNull();
  expect(deletePair(state("|()"))).toBeNull();
});

// ---- Slash commands ----

/** Runs a slash command over the slash and what follows it, up to the cursor. */
function slash(text: string, id: Parameters<typeof slashEdit>[3]): string {
  const s = state(text);
  const head = s.selection.main.head;
  const from = s.doc.sliceString(0, head).lastIndexOf("/");
  return apply(s, slashEdit(s, from, head, id))!;
}

test("line formats go on the line, the slash taken out", () => {
  expect(slash("/h1|", "h1")).toBe("# |");
  expect(slash("hello /bt|", "h2")).toBe("## hello |");
  expect(slash("# old /|", "h3")).toBe("### old |");
  expect(slash("- item /rw|", "task")).toBe("- [ ] item |");
  expect(slash("  /|", "bullet")).toBe("  - |");
  expect(slash("## title /|", "text")).toBe("title |");
  expect(slash("/yy|", "quote")).toBe("> |");
});

test("blocks take an empty line, and go under a line with text", () => {
  expect(slash("/code|", "code")).toBe("```\n|\n```");
  expect(slash("a\n/|\nb", "rule")).toBe("a\n---\n|\nb");
  expect(slash("/bg|", "table")).toBe("| «列 1» | 列 2 |\n| --- | --- |\n|  |  |");
  expect(slash("see /|", "code")).toBe("see \n```\n|\n```");
  expect(slash("/tp|", "image")).toBe("|");
});

test("what follows the slash narrows the menu", () => {
  expect(matchSlash("").length).toBe(12);
  expect(matchSlash("h2").map((c) => c.id)).toEqual(["h2"]);
  expect(matchSlash("bt").map((c) => c.id)).toEqual(["h1", "h2", "h3"]);
  expect(matchSlash("代码").map((c) => c.id)).toEqual(["code"]);
  expect(matchSlash("标题2").map((c) => c.id)).toEqual(["h2"]);
  expect(matchSlash("tab").map((c) => c.id)).toEqual(["table"]);
  expect(matchSlash("zzz")).toEqual([]);
});

// ---- Outline and counts ----

test("the outline lists the headings, the cursor's lit", () => {
  const s = state("intro\n# 一\ntext\n## 二 ##\nmore\n\n三\n---\n|end");
  const list = headingsIn(s);
  expect(list.map((h) => [h.level, h.text])).toEqual([
    [1, "一"],
    [2, "二"],
    [2, "三"],
  ]);
  expect(currentHeading(list, s.selection.main.head)).toBe(2);
  expect(currentHeading(list, 0)).toBe(-1);
});

test("headings in code are not in the outline", () => {
  expect(headingsIn(state("```\n# not\n```\n# yes|")).map((h) => h.text)).toEqual(["yes"]);
});

test("counts take Chinese characters one by one and other words whole", () => {
  const c = countText(state("# 标题\n\n你好 world, **hi** there ![](image:0123456789abcdef.png) [链接](https://x.y)|").doc);
  expect(c.words).toBe(2 + 2 + 3 + 2);
  expect(c.lines).toBe(3);
  expect(c.minutes).toBe(1);
  expect(countText(state("|").doc)).toEqual({ words: 0, lines: 1, minutes: 0 });
});
