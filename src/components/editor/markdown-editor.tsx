import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorSelection, EditorState } from "@codemirror/state";
import { type Command, drawSelection, EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { cn } from "@/lib/utils";
import { linkAt, livePreview } from "./live-preview";

/** Colors of code in fenced blocks, from the theme tokens. */
const codeColors = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--feature)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--done)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--doing)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--improve)" },
  { tag: [tags.typeName, tags.className, tags.tagName], color: "var(--bug)" },
  { tag: [tags.attributeName, tags.propertyName], color: "var(--improve)" },
]);

/** Wraps the selection in mark, or unwraps it when it is wrapped already. */
function wrap(mark: string): Command {
  return (view) => {
    const { state } = view;
    const tr = state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - mark.length, range.from);
      const after = state.sliceDoc(range.to, range.to + mark.length);
      if (before === mark && after === mark) {
        return {
          changes: [
            { from: range.from - mark.length, to: range.from },
            { from: range.to, to: range.to + mark.length },
          ],
          range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
        };
      }
      return {
        changes: [
          { from: range.from, insert: mark },
          { from: range.to, insert: mark },
        ],
        range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
      };
    });
    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

/** Makes the selection a link and selects its address, to type or paste. */
const insertLink: Command = (view) => {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to) || "链接";
    const insert = `[${text}](url)`;
    const urlFrom = range.from + text.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlFrom, urlFrom + 3),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

const formatting = keymap.of([
  { key: "Mod-b", run: wrap("**") },
  { key: "Mod-i", run: wrap("*") },
  { key: "Mod-e", run: wrap("`") },
  { key: "Mod-Shift-x", run: wrap("~~") },
  { key: "Mod-k", run: insertLink },
]);

interface MarkdownEditorProps {
  /** The text the editor starts with; later changes of it are ignored. */
  value: string;
  onChange(value: string): void;
  /** Called as the editor loses the keyboard, to save at once. */
  onBlur?(): void;
  onOpenLink(href: string): void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

/**
 * A Markdown editor with live preview. It owns its text once mounted: give
 * it a key to start over with another document.
 */
export function MarkdownEditor({ value, onChange, onBlur, onOpenLink, placeholder, autoFocus, className }: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onBlur, onOpenLink });
  callbacks.current = { onChange, onBlur, onOpenLink };

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages, completeHTMLTags: false }),
          syntaxHighlighting(codeColors),
          livePreview,
          placeholderText(placeholder ?? ""),
          formatting,
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({ spellcheck: "false" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
            if (u.focusChanged && !u.view.hasFocus) callbacks.current.onBlur?.();
          }),
          EditorView.domEventHandlers({
            mousedown(e, editor) {
              if (e.button !== 0) return false;
              // Rendered links open with a click, links being edited with Ctrl.
              const rendered = (e.target as HTMLElement).closest<HTMLElement>("[data-href]");
              let href = rendered?.dataset.href ?? "";
              if (!href && (e.ctrlKey || e.metaKey)) {
                const pos = editor.posAtCoords({ x: e.clientX, y: e.clientY });
                if (pos !== null) href = linkAt(editor.state, pos);
              }
              if (!href) return false;
              e.preventDefault();
              callbacks.current.onOpenLink(href);
              return true;
            },
          }),
        ],
      }),
    });
    if (autoFocus) view.focus();
    return () => view.destroy();
    // The editor keeps its own text: it starts once, from the first value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className={cn("min-h-0", className)} />;
}
