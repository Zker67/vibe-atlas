// The formatting commands of the Markdown editor (src/components/editor/
// format.ts), on a real CodeMirror state with the real Markdown parser:
// what the toolbar over a selection and the shortcuts do to the text.

import { expect, test } from "bun:test";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";
import {
  formatState,
  setHeading,
  toggleCodeBlock,
  toggleInline,
  toggleLines,
  toggleLink,
} from "../src/components/editor/format";

/** A document with its selection marked: « and » around it, or | for a cursor. */
function editor(marked: string) {
  let anchor = marked.indexOf("«");
  let head: number;
  let doc: string;
  if (anchor >= 0) {
    head = marked.indexOf("»") - 1;
    doc = marked.replace("«", "").replace("»", "");
  } else {
    anchor = head = marked.indexOf("|");
    doc = marked.replace("|", "");
  }
  let state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const events: string[] = [];
  const view = {
    get state() {
      return state;
    },
    dispatch(...specs: (Transaction | TransactionSpec)[]) {
      const tr = specs[0] instanceof Transaction ? specs[0] : state.update(...(specs as TransactionSpec[]));
      events.push(String(tr.annotation(Transaction.userEvent)));
      state = tr.state;
      ensureSyntaxTree(state, state.doc.length, 5000);
    },
  };
  return {
    run(command: Command) {
      command(view as unknown as EditorView);
      return this;
    },
    /** The document with its selection marked, as editor() takes it. */
    get text() {
      const { from, to, empty } = state.selection.main;
      const d = state.doc.toString();
      return empty ? d.slice(0, from) + "|" + d.slice(from) : d.slice(0, from) + "«" + d.slice(from, to) + "»" + d.slice(to);
    },
    get format() {
      return formatState(state);
    },
    events,
  };
}

test("bold wraps the selection and keeps it on the text", () => {
  const e = editor("hello «world»").run(toggleInline("strong"));
  expect(e.text).toBe("hello **«world»**");
  expect(e.format.strong).toBe(true);
  expect(e.events).toEqual(["input.format"]);
});

test("bold comes off the whole run from anywhere inside it", () => {
  expect(editor("a **b«ol»d** c").run(toggleInline("strong")).text).toBe("a b«ol»d c");
  expect(editor("a «**bold**» c").run(toggleInline("strong")).text).toBe("a «bold» c");
});

test("the spaces around a selection stay outside the marks", () => {
  expect(editor("say «hi »there").run(toggleInline("strong")).text).toBe("say **«hi** »there");
});

test("an empty selection gets a pair of marks to type between", () => {
  expect(editor("x |").run(toggleInline("code")).text).toBe("x `|`");
});

test("italic, strikethrough and code toggle on and off", () => {
  const em = editor("«word»").run(toggleInline("em"));
  expect(em.text).toBe("*«word»*");
  expect(em.run(toggleInline("em")).text).toBe("«word»");
  const strike = editor("«gone»").run(toggleInline("strike"));
  expect(strike.text).toBe("~~«gone»~~");
  expect(strike.format.strike).toBe(true);
  expect(strike.run(toggleInline("strike")).text).toBe("«gone»");
  const code = editor("«f()»").run(toggleInline("code"));
  expect(code.text).toBe("`«f()»`");
  expect(code.run(toggleInline("code")).text).toBe("«f()»");
});

test("italic on bold text adds to it", () => {
  const e = editor("**«x»**").run(toggleInline("em"));
  expect(e.text).toBe("***«x»***");
  expect(e.format.strong && e.format.em).toBe(true);
});

test("inline marks go line by line over several lines", () => {
  expect(editor("«one\n\ntwo»").run(toggleInline("strong")).text).toBe("**«one**\n\n**two»**");
});

test("a link selects its address to type, and comes off again", () => {
  const e = editor("see «site»").run(toggleLink);
  expect(e.text).toBe("see [site](«url»)");
  expect(e.format.link).toBe(true);
  expect(e.run(toggleLink).text).toBe("see «site»");
  expect(editor("see |").run(toggleLink).text).toBe("see [链接](«url»)");
  expect(editor("a [si«t»e](https://e.com) b").run(toggleLink).text).toBe("a «site» b");
});

test("headings set, change and clear the level", () => {
  const e = editor("Ti|tle").run(setHeading(2));
  expect(e.text).toBe("## Ti|tle");
  expect(e.format.heading).toBe(2);
  expect(e.run(setHeading(1)).text).toBe("# Ti|tle");
  expect(e.run(setHeading(0)).text).toBe("Ti|tle");
  expect(e.format.heading).toBe(0);
});

test("lists, tasks and quotes go on every line and come off together", () => {
  const list = editor("«a\nb»").run(toggleLines("bullet"));
  expect(list.text).toBe("- «a\n- b»");
  expect(list.format.lines).toBe("bullet");
  expect(list.run(toggleLines("task")).text).toBe("- [ ] «a\n- [ ] b»");
  expect(list.format.lines).toBe("task");
  expect(list.run(toggleLines("task")).text).toBe("«a\nb»");

  const quote = editor("«a\n\nb»").run(toggleLines("quote"));
  expect(quote.text).toBe("> «a\n>\n> b»");
  expect(quote.format.lines).toBe("quote");
  expect(quote.run(toggleLines("quote")).text).toBe("«a\n\nb»");
});

test("a numbered list becomes bullets, a checked task keeps its state", () => {
  expect(editor("1. «x»").run(toggleLines("bullet")).text).toBe("- «x»");
  expect(editor("«- [x] done\n- todo»").run(toggleLines("task")).text).toBe("«- [x] done\n- [ ] todo»");
});

test("a code block fences the lines, and its fences come off", () => {
  const e = editor("«x = 1»").run(toggleCodeBlock);
  expect(e.text).toBe("```\n«x = 1»\n```");
  expect(e.format.codeBlock).toBe(true);
  expect(e.run(toggleCodeBlock).text).toBe("«x = 1»");
  expect(editor("|").run(toggleCodeBlock).text).toBe("```\n|\n```");
});
