import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Maximize2,
  Minimize2,
  Minus,
  PanelLeft,
  Plus,
  Type,
  X,
} from "lucide-react";
import type { Item } from "@/mygo";
import { useDebouncedSave } from "@/lib/debounce";
import { isComposing } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { countText, currentHeading, headingsIn } from "@/components/editor/immersive";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Scroller } from "@/components/ui/scroller";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { copyItem, openLink, select, setItemNote, setItemStatus, setItemTitle, useAtlas } from "@/state/atlas";
import { closeImmersive, FONT_SIZES, type LineWidth, setImmersivePrefs, useImmersive } from "@/state/immersive";
import { IconButton } from "./icon-button";
import { StatusPicker, TypeSelect } from "./item-detail";
import { visibleItems } from "./queue";

// The notes of the selected item in a dialog of their own, to write at
// length: a status bar with the counts and whether they are saved, an
// outline, focus mode, typewriter scrolling, the width and size of the text,
// the whole window when wanted, and the item's title, status and kind
// within reach. Alt+PageUp / Alt+PageDown move to the item above or below
// in the queue without leaving.

const WIDTHS: Record<LineWidth, { label: string; max: string }> = {
  narrow: { label: "窄", max: "36rem" },
  medium: { label: "中", max: "46rem" },
  wide: { label: "宽", max: "64rem" },
};

/**
 * The saving now under way, and the way to save at once what still waits:
 * closing waits for them, so that the detail panel then shows the notes as
 * saved.
 */
const session = { flush: () => {}, saving: Promise.resolve() as Promise<unknown> };

async function requestClose() {
  session.flush();
  await session.saving;
  closeImmersive();
}

/** Moves to the item above or below in the queue, as it shows now. */
function step(delta: number) {
  const list = visibleItems();
  const { selectedId } = useAtlas.getState();
  const at = list.findIndex((i) => i.id === selectedId);
  const next = list[at + delta];
  if (at >= 0 && next) select(next.id);
}

export function ImmersiveNote() {
  const open = useImmersive((s) => s.open);
  const full = useImmersive((s) => s.full);
  const item = useAtlas((s) => (s.selectedIds.size > 1 ? undefined : s.items.find((i) => i.id === s.selectedId)));
  // Nothing left to show, the item deleted or several selected: closed.
  useEffect(() => {
    if (open && !item) closeImmersive();
  }, [open, item]);

  return (
    <Dialog open={open && !!item} onOpenChange={(o) => !o && void requestClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0 transition-[width,height,max-width] duration-200",
          full ? "h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-none rounded-lg sm:max-w-none" : "h-[88vh] sm:max-w-5xl",
        )}
        // The editor takes the keyboard itself, with the cursor in the text.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          // Escape closes the find panel, or puts back a title being changed, before the dialog.
          const target = e.target instanceof Element ? e.target : null;
          if (target?.closest(".cm-panels") || target?.closest("[data-immersive-title][data-dirty]")) e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (isComposing(e)) return;
          if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "PageUp" || e.key === "PageDown")) {
            e.preventDefault();
            step(e.key === "PageDown" ? 1 : -1);
          } else if (e.key === "F11" && !e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setImmersivePrefs({ full: !useImmersive.getState().full });
          }
        }}
      >
        <DialogDescription className="sr-only">
          沉浸式编辑这一条改进点的备注，停顿时自动保存。Alt+PageUp、Alt+PageDown 切换上一条、下一条，F11 铺满窗口，Esc 关闭。
        </DialogDescription>
        {item && <ImmersiveBody key={item.id} item={item} />}
      </DialogContent>
    </Dialog>
  );
}

type SaveState = "saved" | "dirty" | "saving" | "error";

function ImmersiveBody({ item }: { item: Item }) {
  const prefs = useImmersive();
  const [state, setState] = useState<EditorState | null>(null);
  const view = useRef<EditorView | null>(null);
  const [save, setSave] = useState<{ state: SaveState; at: number }>({ state: "saved", at: 0 });

  const { schedule, flush } = useDebouncedSave((note) => {
    setSave((s) => ({ ...s, state: "saving" }));
    const saving = setItemNote(item.id, note).then((saved) =>
      setSave(saved ? { state: "saved", at: Date.now() } : (s) => ({ ...s, state: "error" })),
    );
    session.saving = saving;
  });
  useEffect(() => {
    session.flush = flush;
    return () => {
      session.flush = () => {};
    };
  }, [flush]);

  const headings = useMemo(() => (state ? headingsIn(state) : []), [state]);
  const at = state ? currentHeading(headings, state.selection.main.head) : -1;
  const doc = state?.doc;
  const counts = useMemo(() => (doc ? countText(doc) : null), [doc]);

  const jump = (from: number) => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: "start", yMargin: 24 }) });
    v.focus();
  };

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <TitleField item={item} />
        <StatusPicker value={item.status} onPick={(status) => void setItemStatus(item.id, status)} />
        <TypeSelect item={item} />
        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
        <IconButton label="上一条" shortcut="Alt+PageUp" onClick={() => step(-1)}>
          <ChevronUp />
        </IconButton>
        <IconButton label="下一条" shortcut="Alt+PageDown" onClick={() => step(1)}>
          <ChevronDown />
        </IconButton>
        <IconButton label="复制给 AI" onClick={() => void copyItem(item.id)}>
          <Copy />
        </IconButton>
        <IconButton
          label={prefs.outline ? "收起大纲" : "显示大纲"}
          aria-pressed={prefs.outline}
          className={cn(prefs.outline && "bg-muted")}
          onClick={() => setImmersivePrefs({ outline: !prefs.outline })}
        >
          <PanelLeft />
        </IconButton>
        <LookMenu />
        <IconButton label={prefs.full ? "退出铺满" : "铺满窗口"} shortcut="F11" onClick={() => setImmersivePrefs({ full: !prefs.full })}>
          {prefs.full ? <Minimize2 /> : <Maximize2 />}
        </IconButton>
        <IconButton label="关闭" shortcut="Esc" onClick={() => void requestClose()}>
          <X />
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1">
        {prefs.outline && (
          <nav aria-label="大纲" className="flex w-56 shrink-0 flex-col border-r bg-muted/30 animate-in duration-200 fade-in-0 slide-in-from-left-2">
            <p className="px-4 pt-4 pb-2 text-xs font-medium text-muted-foreground">大纲</p>
            <Scroller className="min-h-0 flex-1" viewportClassName="px-2 pb-4">
              {headings.length === 0 ? (
                <p className="px-2 text-xs leading-relaxed text-muted-foreground/80">
                  用 <Kbd>#</Kbd> 写标题，或输入 <Kbd>/</Kbd> 选「标题」，这里会列出来。
                </p>
              ) : (
                <ul className="flex flex-col gap-px">
                  {headings.map((h, i) => (
                    <li key={`${h.from}-${i}`}>
                      <button
                        type="button"
                        aria-current={i === at ? "location" : undefined}
                        title={h.text}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => jump(h.from)}
                        style={{ paddingLeft: `${0.5 + (Math.min(h.level, 4) - 1) * 0.75}rem` }}
                        className={cn(
                          "relative flex h-7 w-full items-center truncate rounded-md pr-2 text-left text-xs text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground",
                          h.level === 1 && "font-medium",
                          i === at && "bg-accent text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-improve",
                        )}
                      >
                        <span className="truncate">{h.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Scroller>
          </nav>
        )}
        <Scroller className="min-h-0 flex-1" viewportClassName="px-10 pt-8">
          <div
            className="immersive-editor mx-auto"
            style={{ maxWidth: WIDTHS[prefs.width].max, ["--immersive-font" as string]: `${prefs.fontSize}px` }}
          >
            <MarkdownEditor
              value={item.note}
              autoFocus
              immersive={{ focus: prefs.focus, typewriter: prefs.typewriter }}
              className="min-h-[60vh]"
              placeholder="用 Markdown 写，边写边预览；输入 / 插入标题、列表、代码块、表格、图片"
              onChange={(note) => {
                setSave((s) => ({ ...s, state: "dirty" }));
                schedule(note);
              }}
              onBlur={flush}
              onOpenLink={openLink}
              onState={setState}
              onView={(v) => (view.current = v)}
            />
          </div>
        </Scroller>
      </div>

      <footer className="flex h-8 shrink-0 items-center gap-4 border-t px-4 text-xs text-muted-foreground">
        {counts && (
          <span className="meta-mono">
            {counts.words} 字 · {counts.lines} 行{counts.minutes > 0 && ` · 约 ${counts.minutes} 分钟读完`}
          </span>
        )}
        <SaveBadge save={save} />
        <span className="ml-auto hidden items-center gap-3 md:flex">
          <Hint keys={["/"]}>插入</Hint>
          <Hint keys={["Ctrl", "F"]}>查找</Hint>
          <Hint keys={["Alt", "PgDn"]}>下一条</Hint>
          <Hint keys={["F11"]}>铺满</Hint>
          <Hint keys={["Esc"]}>关闭</Hint>
        </span>
      </footer>
    </>
  );
}

/** The title, changed in place: Enter or leaving saves, Escape puts it back. */
function TitleField({ item }: { item: Item }) {
  const [draft, setDraft] = useState(item.title);
  const [prev, setPrev] = useState(item.title);
  // Changed elsewhere meanwhile: show it.
  if (item.title !== prev) {
    setPrev(item.title);
    setDraft(item.title);
  }
  const dirty = draft !== item.title;
  const commit = () => {
    const title = draft.trim();
    if (title && title !== item.title) void setItemTitle(item.id, title);
    else setDraft(item.title);
  };
  return (
    <>
      <DialogTitle className="sr-only">备注 · {item.title}</DialogTitle>
      <input
        data-immersive-title=""
        data-dirty={dirty ? "" : undefined}
        aria-label="标题"
        value={draft}
        maxLength={300}
        spellCheck={false}
        title={item.title}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (isComposing(e)) return;
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape" && dirty) {
            setDraft(item.title);
          }
        }}
        className="h-8 min-w-0 flex-1 truncate rounded-md bg-transparent px-2 text-base font-semibold outline-none transition-colors duration-150 hover:bg-muted/60 focus:bg-muted/60 focus:ring-2 focus:ring-ring/40"
      />
    </>
  );
}

/** The look of the text: width, size, focus mode and typewriter scrolling. */
function LookMenu() {
  const prefs = useImmersive();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <IconButton label="排版">
            <Type />
          </IconButton>
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-3 p-3" onCloseAutoFocus={(e) => e.preventDefault()}>
        <Row label="行宽">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={prefs.width}
            onValueChange={(v) => v && setImmersivePrefs({ width: v as LineWidth })}
          >
            {(Object.keys(WIDTHS) as LineWidth[]).map((w) => (
              <ToggleGroupItem key={w} value={w} className="px-2.5">
                {WIDTHS[w].label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Row>
        <Row label="字号">
          <span className="flex items-center gap-1">
            <IconButton
              label="小一号"
              size="icon-xs"
              variant="outline"
              disabled={prefs.fontSize <= FONT_SIZES.min}
              onClick={() => setImmersivePrefs({ fontSize: prefs.fontSize - FONT_SIZES.step })}
            >
              <Minus />
            </IconButton>
            <span className="meta-mono w-9 text-center">{prefs.fontSize}px</span>
            <IconButton
              label="大一号"
              size="icon-xs"
              variant="outline"
              disabled={prefs.fontSize >= FONT_SIZES.max}
              onClick={() => setImmersivePrefs({ fontSize: prefs.fontSize + FONT_SIZES.step })}
            >
              <Plus />
            </IconButton>
          </span>
        </Row>
        <label className="flex items-center justify-between gap-3">
          <span className="flex flex-col">
            <span>专注模式</span>
            <span className="text-xs text-muted-foreground">只突出光标所在的段落</span>
          </span>
          <Switch checked={prefs.focus} onCheckedChange={(focus) => setImmersivePrefs({ focus })} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="flex flex-col">
            <span>打字机滚动</span>
            <span className="text-xs text-muted-foreground">正在写的那一行保持在中间</span>
          </span>
          <Switch checked={prefs.typewriter} onCheckedChange={(typewriter) => setImmersivePrefs({ typewriter })} />
        </label>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {children}
    </div>
  );
}

function SaveBadge({ save }: { save: { state: SaveState; at: number } }) {
  const look: Record<SaveState, { text: string; dot: string }> = {
    saved: { text: save.at ? `已保存 · ${new Date(save.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "已保存", dot: "bg-done" },
    dirty: { text: "未保存", dot: "bg-muted-foreground/60" },
    saving: { text: "保存中…", dot: "bg-doing animate-pulse" },
    error: { text: "保存失败", dot: "bg-destructive" },
  };
  const l = look[save.state];
  return (
    <span className="flex items-center gap-1.5" aria-live="polite">
      <span aria-hidden className={cn("size-1.5 rounded-full", l.dot)} />
      {l.text}
    </span>
  );
}

function Hint({ keys, children }: { keys: string[]; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k) => (
        <Kbd key={k} className="h-4.5 min-w-4.5 px-1 text-[10px]">
          {k}
        </Kbd>
      ))}
      {children}
    </span>
  );
}
