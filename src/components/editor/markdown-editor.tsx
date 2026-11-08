import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { cn } from "@/lib/utils";
import { toggleInline, toggleLink } from "./format";
import { formatToolbar } from "./format-toolbar";
import { autopair } from "./autopair";
import { images } from "./images";
import { type ImmersiveOptions, immersiveExtensions } from "./immersive";
import { linkAt, livePreview } from "./live-preview";
import { slashMenu } from "./slash";

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

/** The words of the find and replace panel. */
const searchPhrases = EditorState.phrases.of({
  Find: "查找",
  Replace: "替换为",
  next: "下一个",
  previous: "上一个",
  all: "全选",
  "match case": "区分大小写",
  "by word": "全字匹配",
  regexp: "正则",
  replace: "替换",
  "replace all": "全部替换",
  close: "关闭",
  "current match": "当前匹配",
  "replaced $ matches": "替换了 $ 处",
  "replaced match on line $": "替换了第 $ 行的匹配",
  "on line": "在第几行",
  "Go to line": "跳到行",
  go: "跳转",
});

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
  /** In the immersive dialog: folding, and focus mode and typewriter scrolling when on. */
  immersive?: ImmersiveOptions;
  /** Told the editor's state as it starts and whenever its text or selection changes. */
  onState?(state: EditorState): void;
  /** Given the editor once it is made, and null as it goes. */
  onView?(view: EditorView | null): void;
}

/**
 * A Markdown editor with live preview. It owns its text once mounted: give
 * it a key to start over with another document.
 */
export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  onOpenLink,
  placeholder,
  autoFocus,
  className,
  immersive,
  onState,
  onView,
}: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onBlur, onOpenLink, onState, onView });
  callbacks.current = { onChange, onBlur, onOpenLink, onState, onView };
  const immersiveSlot = useRef(new Compartment());

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
          slashMenu,
          autopair,
          search({ top: true }),
          searchPhrases,
          formatting,
          keymap.of([{ key: "Mod-h", run: openSearchPanel }, ...searchKeymap]),
          immersiveSlot.current.of(immersive ? immersiveExtensions(immersive) : []),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({ spellcheck: "false" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
            if (u.docChanged || u.selectionSet) callbacks.current.onState?.(u.state);
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
    callbacks.current.onView?.(view);
    callbacks.current.onState?.(view.state);
    if (autoFocus) view.focus();
    return () => {
      viewRef.current = null;
      callbacks.current.onView?.(null);
      view.destroy();
    };
    // The editor keeps its own text: it starts once, from the first value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The immersive options change while the editor stays.
  const focus = immersive?.focus;
  const typewriter = immersive?.typewriter;
  useEffect(() => {
    const view = viewRef.current;
    if (!view || focus === undefined || typewriter === undefined) return;
    view.dispatch({ effects: immersiveSlot.current.reconfigure(immersiveExtensions({ focus, typewriter })) });
  }, [focus, typewriter]);

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
