// Live preview for Markdown in CodeMirror: lines show their Markdown as
// written while the cursor is on them, and rendered everywhere else, as
// Obsidian's live preview does. Headings keep their size either way, so
// lines do not jump as the cursor moves.

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { onPictureLine } from "./images";

const hidden = Decoration.replace({});
const markClass = (cls: string) => Decoration.mark({ class: cls });
const dim = markClass("cm-md-mark");

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-md-bullet";
    el.textContent = "•";
    return el;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-md-hr";
    return el;
  }
}

/** A task's box, which a click checks or unchecks in the text. */
class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("span");
    box.className = "cm-md-task" + (this.checked ? " cm-md-task-checked" : "");
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(box);
      if (!/^\[[ xX]\]$/.test(view.state.sliceDoc(pos, pos + 3))) return;
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? " " : "x" }, userEvent: "input" });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

/** The lines the cursor or the selection is on, none while unfocused. */
function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  const { doc, selection } = view.state;
  for (const r of selection.ranges) {
    const last = doc.lineAt(r.to).number;
    for (let n = doc.lineAt(r.from).number; n <= last; n++) lines.add(n);
  }
  return lines;
}

/** The link a bare URL opens: www. ones on https, addresses by mail. */
function bareHref(text: string): string {
  if (/^www\./i.test(text)) return "https://" + text;
  if (!text.includes(":") && text.includes("@")) return "mailto:" + text;
  return text;
}

/** Hides a mark and the space after it, as "# " or "> ". */
function hideWithSpace(state: EditorState, out: Range<Decoration>[], node: SyntaxNode) {
  let end = node.to;
  if (state.sliceDoc(end, end + 1) === " ") end++;
  out.push(hidden.range(node.from, end));
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const active = activeLines(view);
  const isActive = (from: number, to = from) => {
    const last = doc.lineAt(to).number;
    for (let n = doc.lineAt(from).number; n <= last; n++) if (active.has(n)) return true;
    return false;
  };
  const out: Range<Decoration>[] = [];
  const line = (pos: number, cls: string) => out.push(Decoration.line({ class: cls }).range(doc.lineAt(pos).from));
  const link = (from: number, to: number, href: string, render: boolean) =>
    out.push(Decoration.mark({ class: "cm-md-link", attributes: render && href ? { "data-href": href } : {} }).range(from, to));

  const ranges = view.visibleRanges;
  if (ranges.length === 0) return Decoration.none;
  const from = ranges[0]!.from;
  const to = ranges[ranges.length - 1]!.to;

  syntaxTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      const node = ref.node;
      const name = ref.name;
      const render = !isActive(ref.from);

      if (/^ATXHeading[1-6]$/.test(name) || /^SetextHeading[12]$/.test(name)) {
        line(ref.from, `cm-md-h${name.slice(-1)}`);
        return;
      }
      switch (name) {
        case "HeaderMark":
          if (node.parent?.name.startsWith("ATXHeading")) {
            if (render) hideWithSpace(state, out, node);
            else out.push(dim.range(ref.from, ref.to));
          }
          return;
        case "Emphasis":
          out.push(markClass("cm-md-em").range(ref.from, ref.to));
          return;
        case "StrongEmphasis":
          out.push(markClass("cm-md-strong").range(ref.from, ref.to));
          return;
        case "Strikethrough":
          out.push(markClass("cm-md-strike").range(ref.from, ref.to));
          return;
        case "InlineCode":
          out.push(markClass("cm-md-code").range(ref.from, ref.to));
          return;
        case "EmphasisMark":
        case "StrikethroughMark":
          out.push((render ? hidden : dim).range(ref.from, ref.to));
          return;
        case "CodeMark":
          if (node.parent?.name === "InlineCode") out.push((render ? hidden : dim).range(ref.from, ref.to));
          return;
        case "Link": {
          const marks = node.getChildren("LinkMark");
          const open = marks[0];
          const close = marks[1];
          const url = node.getChild("URL");
          if (open && close && open.to <= close.from) {
            link(open.to, close.from, url ? state.sliceDoc(url.from, url.to) : "", render);
            if (render) {
              out.push(hidden.range(open.from, open.to));
              out.push(hidden.range(close.from, ref.to));
            } else {
              out.push(dim.range(open.from, open.to));
              out.push(dim.range(close.from, ref.to));
            }
          }
          return false;
        }
        case "Image": {
          // Pictures of the app show as cards (images.ts), which take a
          // line of pictures whole; others show as written.
          const url = node.getChild("URL");
          if (url && state.sliceDoc(url.from, url.to).startsWith("image:")) {
            if (!render) out.push(dim.range(ref.from, ref.to));
            else if (!onPictureLine(state, ref.from)) out.push(hidden.range(ref.from, ref.to));
          }
          return false;
        }
        case "Autolink": {
          // <https://…>
          const url = node.getChild("URL");
          if (url) {
            link(url.from, url.to, state.sliceDoc(url.from, url.to), render);
            if (render) {
              out.push(hidden.range(ref.from, url.from));
              out.push(hidden.range(url.to, ref.to));
            }
          }
          return false;
        }
        case "URL":
          // A bare link, autolinked: Links and Autolinks handle their own.
          link(ref.from, ref.to, bareHref(state.sliceDoc(ref.from, ref.to)), render);
          return;
        case "Blockquote":
          for (let pos = ref.from; pos <= ref.to; ) {
            const l = doc.lineAt(pos);
            line(l.from, "cm-md-quote");
            pos = l.to + 1;
          }
          return;
        case "QuoteMark":
          if (render) hideWithSpace(state, out, node);
          else out.push(dim.range(ref.from, ref.to));
          return;
        case "FencedCode": {
          const first = doc.lineAt(ref.from);
          const last = doc.lineAt(ref.to);
          const closed = last.number > first.number && /^\s*(`{3,}|~{3,})/.test(last.text);
          for (let n = first.number; n <= last.number; n++) {
            let cls = "cm-md-fence";
            if (n === first.number) cls += " cm-md-fence-first cm-md-fence-edge";
            if (n === last.number) cls += " cm-md-fence-last" + (closed ? " cm-md-fence-edge" : "");
            line(doc.line(n).from, cls);
          }
          return false;
        }
        case "ListMark": {
          const item = node.parent;
          const task = item?.getChild("Task");
          if (task) {
            if (render) hideWithSpace(state, out, node);
            else out.push(dim.range(ref.from, ref.to));
          } else if (item?.parent?.name === "BulletList" && render) {
            out.push(Decoration.replace({ widget: new BulletWidget() }).range(ref.from, ref.to));
          } else {
            out.push(dim.range(ref.from, ref.to));
          }
          return;
        }
        case "TaskMarker": {
          const checked = /x/i.test(state.sliceDoc(ref.from, ref.to));
          if (render) out.push(Decoration.replace({ widget: new TaskWidget(checked) }).range(ref.from, ref.to));
          const l = doc.lineAt(ref.from);
          if (checked && ref.to < l.to) out.push(markClass("cm-md-task-line-done").range(ref.to, l.to));
          return;
        }
        case "HorizontalRule":
          if (render) out.push(Decoration.replace({ widget: new RuleWidget() }).range(ref.from, ref.to));
          return;
      }
      return;
    },
  });
  return Decoration.set(out, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.focusChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** The link at a position, for Ctrl+click on a line being edited. */
export function linkAt(state: EditorState, pos: number): string {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  for (; node; node = node.parent) {
    if (node.name === "Link") {
      const url = node.getChild("URL");
      return url ? state.sliceDoc(url.from, url.to) : "";
    }
    if (node.name === "URL") return bareHref(state.sliceDoc(node.from, node.to));
  }
  return "";
}
