// A line of `---` is always a rule, even right under text: Markdown would
// make the text above it a heading, which nobody means when typing `---`.
// Text underlined with `===` is still a heading.

import type { BlockContext, LeafBlock, LeafBlockParser, Line, MarkdownConfig } from "@lezer/markdown";

/** Where the `===` underline ends, or -1 when the line is not one. */
function underlineEnd(line: Line): number {
  if (line.next !== 61 /* '=' */ || line.indent >= line.baseIndent + 4) return -1;
  let pos = line.pos + 1;
  while (pos < line.text.length && line.text.charCodeAt(pos) === 61) pos++;
  const end = pos;
  while (pos < line.text.length) {
    const ch = line.text.charCodeAt(pos);
    if (ch !== 32 && ch !== 9) return -1;
    pos++;
  }
  return end;
}

/** How many of the open blocks (quotes, lists) the line continues; set by lezer but left out of its types. */
type LineWithDepth = Line & { depth: number };

class EqualsHeadingParser implements LeafBlockParser {
  nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
    const end = (line as LineWithDepth).depth < cx.depth ? -1 : underlineEnd(line);
    if (end < 0) return false;
    const mark = cx.elt("HeaderMark", cx.lineStart + line.pos, cx.lineStart + end);
    cx.nextLine();
    cx.addLeafElement(
      leaf,
      cx.elt("SetextHeading1", leaf.start, cx.prevLineEnd(), [...cx.parser.parseInline(leaf.content, leaf.start), mark]),
    );
    return true;
  }
  finish(): boolean {
    return false;
  }
}

/** Takes the place of the built-in Setext heading parser. */
export const dashIsRule: MarkdownConfig = {
  parseBlock: [{ name: "SetextHeading", leaf: () => new EqualsHeadingParser() }],
};
