// Pairs of marks in the Markdown editor: typing an opening one adds its
// closing one, typing the closing one steps over it, and Backspace between
// an empty pair takes both. With text selected, an opening mark, or * _ ~,
// wraps it. Only for one cursor, and never while an input method composes.

import { EditorSelection, type EditorState, Prec, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "`": "`", '"': '"' };
const CLOSERS = new Set(Object.values(PAIRS));
const WRAPS = new Set(["*", "_", "~"]);

/** Whether a pair may open before next: at the end of a line, before a space, a closing mark or punctuation. */
const opensBefore = (next: string) => next === "" || /[\s)\]}.,;:!?，。；：！？、）】」』》]/.test(next);

/** What typing text over from–to does with pairs, or null for plain typing. */
export function pairInput(state: EditorState, from: number, to: number, text: string): TransactionSpec | null {
  if (text.length !== 1 || state.selection.ranges.length !== 1) return null;
  const range = state.selection.main;
  if (range.from !== from || range.to !== to) return null;
  const close = PAIRS[text];

  if (!range.empty) {
    if (!close && !WRAPS.has(text)) return null;
    return {
      changes: [
        { from, insert: text },
        { from: to, insert: close ?? text },
      ],
      selection: EditorSelection.range(from + 1, to + 1),
    };
  }
  const next = state.sliceDoc(from, from + 1);
  const before = state.sliceDoc(Math.max(0, from - 2), from);
  if (CLOSERS.has(text) && next === text) {
    // ``` for a code block: the third goes in, not over.
    if (text === "`" && before === "``") return null;
    return { selection: EditorSelection.cursor(from + 1) };
  }
  if (!close || !opensBefore(next)) return null;
  // A quote or backtick right after a word is not an opening one.
  if ((text === '"' || text === "`") && /[\p{L}\p{N}]$/u.test(before)) return null;
  if (text === "`" && before.endsWith("`")) return null;
  return { changes: { from, insert: text + close }, selection: EditorSelection.cursor(from + 1) };
}

/** What Backspace between an empty pair does, or null to delete as ever. */
export function deletePair(state: EditorState): TransactionSpec | null {
  if (state.selection.ranges.length !== 1) return null;
  const { head, empty } = state.selection.main;
  if (!empty || head === 0) return null;
  const open = state.sliceDoc(head - 1, head);
  if (PAIRS[open] === undefined || state.sliceDoc(head, head + 1) !== PAIRS[open]) return null;
  return { changes: { from: head - 1, to: head + 1 } };
}

export const autopair = [
  EditorView.inputHandler.of((view, from, to, text) => {
    if (view.composing) return false;
    const spec = pairInput(view.state, from, to, text);
    if (!spec) return false;
    view.dispatch({ ...spec, scrollIntoView: true, userEvent: "input.type" });
    return true;
  }),
  Prec.high(
    keymap.of([
      {
        key: "Backspace",
        run: (view) => {
          const spec = deletePair(view.state);
          if (!spec) return false;
          view.dispatch({ ...spec, scrollIntoView: true, userEvent: "delete.backward" });
          return true;
        },
      },
    ]),
  ),
];
