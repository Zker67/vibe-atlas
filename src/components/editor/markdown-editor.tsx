import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { cn } from "@/lib/utils";
import { toggleInline, toggleLink } from "./format";
import { formatToolbar } from "./format-toolbar";
import { images } from "./images";
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

const formatting = keymap.of([
  { key: "Mod-b", run: toggleInline("strong") },
  { key: "Mod-i", run: toggleInline("em") },
  { key: "Mod-e", run: toggleInline("code") },
  { key: "Mod-Shift-x", run: toggleInline("strike") },
  { key: "Mod-k", run: toggleLink },
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
  const viewRef = useRef<EditorView | null>(null);
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
          images,
          formatToolbar,
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
    viewRef.current = view;
    if (autoFocus) view.focus();
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // The editor keeps its own text: it starts once, from the first value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A click in the box around the text, below or beside it, starts typing
  // at the end, as in a text field.
  return (
    <div
      ref={host}
      className={cn("min-h-0 cursor-text", className)}
      onMouseDown={(e) => {
        const view = viewRef.current;
        if (!view || e.button !== 0 || view.dom.contains(e.target as Node)) return;
        e.preventDefault();
        view.focus();
        view.dispatch({ selection: { anchor: view.state.doc.length } });
      }}
    />
  );
}
