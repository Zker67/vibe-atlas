// Tables in the Markdown editor: while the cursor is out of a table, it
// shows as one, its header bold, its columns aligned as its delimiter row
// says, the Markdown in its cells rendered; a click in a cell puts the
// cursor there, in its Markdown. In the Markdown, Tab and Shift+Tab move
// between the cells, lining the columns up, and Enter at the end of a row
// adds one (table-model.ts).

import { Prec, type EditorState, type Range, StateField, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { focused } from "./images";
import { type Align, type Table, tableNewRow, tableShiftTab, tablesIn, tableTab } from "./table-model";

/** The inline Markdown of a cell as elements: code, bold, italics, strikethrough, links. */
const inlinePattern =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*([^*\s](?:[^*]*[^*\s])?)\*|(?<![\w])_([^_\s](?:[^_]*[^_\s])?)_(?![\w])|\[([^\]]+)\]\(<?([^()\s<>]+)>?\)/;

function renderInline(text: string, parent: HTMLElement) {
  let rest = text;
  while (rest) {
    const m = inlinePattern.exec(rest);
    if (!m) {
      parent.append(unescapeCell(rest));
      return;
    }
    if (m.index > 0) parent.append(unescapeCell(rest.slice(0, m.index)));
    if (m[1]) {
      const code = document.createElement("code");
      code.className = "cm-md-code";
      code.textContent = m[2]!;
      parent.append(code);
    } else if (m[3] !== undefined || m[4] !== undefined) {
      const b = document.createElement("strong");
      renderInline(m[3] ?? m[4]!, b);
      parent.append(b);
    } else if (m[5] !== undefined) {
      const s = document.createElement("s");
      renderInline(m[5], s);
      parent.append(s);
    } else if (m[6] !== undefined || m[7] !== undefined) {
      const i = document.createElement("em");
      renderInline(m[6] ?? m[7]!, i);
      parent.append(i);
    } else {
      const a = document.createElement("span");
      a.className = "cm-md-link";
      // Opened by the editor's handling of rendered links.
      a.dataset.href = m[9]!;
      renderInline(m[8]!, a);
      parent.append(a);
    }
    rest = rest.slice(m.index + m[0].length);
  }
}

function unescapeCell(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, "$1");
}

const alignClass: Record<Align, string> = { "": "", left: "left", center: "center", right: "right" };

/** A table, rendered. */
class TableWidget extends WidgetType {
  constructor(
    readonly table: Table,
    readonly source: string,
  ) {
    super();
  }
  eq(other: TableWidget) {
    return other.source === this.source && other.table.from === this.table.from;
  }
  get estimatedHeight() {
    return (this.table.rows.length - 1) * 34 + 12;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table-wrap";
    const table = document.createElement("table");
    table.className = "cm-md-table";
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    const columns = Math.max(this.table.aligns.length, ...this.table.rows.filter((r) => !r.delimiter).map((r) => r.cells.length));
    this.table.rows
      .filter((r) => !r.delimiter)
      .forEach((row, i) => {
        const tr = document.createElement("tr");
        for (let c = 0; c < columns; c++) {
          const cell = document.createElement(i === 0 ? "th" : "td");
          const align = alignClass[this.table.aligns[c] ?? ""];
          if (align) cell.dataset.align = align;
          cell.dataset.row = String(i);
          cell.dataset.col = String(c);
          const src = row.cells[c];
          if (src) renderInline(src.text, cell);
          tr.append(cell);
        }
        (i === 0 ? thead : tbody).append(tr);
      });
    table.append(thead, tbody);
    wrap.append(table);

    wrap.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const target = e.target as Element;
      // Links open with the editor's own handling.
      if (target.closest("[data-href]")) return;
      const cell = target.closest<HTMLElement>("th, td");
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.cellPos(view, cell) } });
      view.focus();
    });
    return wrap;
  }
  /**
   * Where in the Markdown the cell clicked is: the end of its text, or the
   * table's start. A table drawn is where it was built, as eq keeps it.
   */
  cellPos(view: EditorView, cell: HTMLElement | null): number {
    if (!cell) return this.table.from;
    const rows = this.table.rows.filter((r) => !r.delimiter);
    const r = rows[Number(cell.dataset.row)];
    const c = r?.cells[Number(cell.dataset.col)] ?? r?.cells[r.cells.length - 1];
    return Math.min(c ? c.to : this.table.from, view.state.doc.length);
  }
  ignoreEvent(e: Event) {
    // Rendered links go to the editor, which opens them; the rest is the table's.
    return !(e.target instanceof Element && e.target.closest("[data-href]"));
  }
}

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  const hasFocus = state.field(focused);
  const { selection } = state;
  for (const t of tablesIn(state)) {
    const touched = hasFocus && selection.ranges.some((r) => r.to >= t.from && r.from <= t.to);
    if (touched) continue;
    out.push(Decoration.replace({ widget: new TableWidget(t, state.sliceDoc(t.from, t.to)), block: true }).range(t.from, t.to));
  }
  return Decoration.set(out, true);
}

function rebuilds(tr: Transaction): boolean {
  return (
    tr.docChanged ||
    tr.selection !== undefined ||
    tr.startState.field(focused) !== tr.state.field(focused) ||
    syntaxTree(tr.startState) !== syntaxTree(tr.state)
  );
}

const rendered = StateField.define<DecorationSet>({
  create: (state) => build(state),
  update: (value, tr) => (rebuilds(tr) ? build(tr.state) : value),
  provide: (f) => EditorView.decorations.from(f),
});

/** The tables, rendered, and their keys; after images, whose focus they follow, and the slash menu, whose keys win while it is open. */
export const tables = [
  rendered,
  Prec.highest(
    keymap.of([
      { key: "Tab", run: tableTab, shift: tableShiftTab },
      { key: "Enter", run: tableNewRow },
    ]),
  ),
];
