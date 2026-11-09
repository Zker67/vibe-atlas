import { useMemo, useState, type ReactNode } from "react";
import { ImagePlus, LoaderCircle, RefreshCw, Search, Shapes, Smile, Wand, type LucideIcon } from "lucide-react";
import { Atlas } from "@/mygo";
import { run } from "@/lib/api";
import { isComposing } from "@/lib/keys";
import { BUILTIN_ICONS, EMOJIS, isEmoji, parseIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Scroller } from "@/components/ui/scroller";
import { EntityIcon } from "./entity-icon";

type Tab = "lucide" | "emoji" | "image";

const TABS: { value: Tab; label: string; icon: LucideIcon }[] = [
  { value: "lucide", label: "图标", icon: Shapes },
  { value: "emoji", label: "Emoji", icon: Smile },
  { value: "image", label: "图片", icon: ImagePlus },
];

export interface AutoIcon {
  /** The project's own icon found in its folder, or "". */
  detected: string;
  /** Whether the project is bound to a folder. */
  hasFolder: boolean;
  /** Looks in the folder again; given only for a project saved already. */
  onDetect?(): Promise<void>;
}

interface IconPickerProps {
  /** The icon chosen, "" for the default. */
  value: string;
  onPick(icon: string): void;
  /** The icon shown by default. */
  fallback: LucideIcon;
  /** For a project: the default is 自动, its own icon found in its folder. */
  auto?: AutoIcon;
  /** Sizes the picker; its lists scroll in what is left. */
  className?: string;
}

/** Picks the icon of a project or module: the default, a built-in icon, an emoji or a picture. */
export function IconPicker({ value, onPick, fallback, auto, className }: IconPickerProps) {
  const kind = parseIcon(value).kind;
  const [tab, setTab] = useState<Tab>(kind === "emoji" || kind === "image" ? kind : "lucide");

  return (
    <div className={cn("flex min-h-0 w-[22rem] flex-col gap-2", className)}>
      <DefaultChoice selected={value === ""} fallback={fallback} auto={auto} onPick={() => onPick("")} />

      <div role="tablist" aria-label="图标的种类" className="flex shrink-0 rounded-lg bg-muted p-0.5">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs transition-all duration-150",
              tab === t.value ? "bg-foreground/10 text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      <div key={tab} className="flex min-h-0 flex-1 flex-col animate-in duration-150 fade-in-0">
        {tab === "lucide" && <LucideTab value={value} onPick={onPick} />}
        {tab === "emoji" && <EmojiTab value={value} onPick={onPick} />}
        {tab === "image" && <ImageTab value={value} fallback={fallback} onPick={onPick} />}
      </div>
    </div>
  );
}

function DefaultChoice({ selected, fallback, auto, onPick }: { selected: boolean; fallback: LucideIcon; auto?: AutoIcon; onPick(): void }) {
  const [detecting, setDetecting] = useState(false);
  let title = "默认图标";
  let note = "";
  if (auto) {
    title = "自动";
    if (!auto.hasFolder) note = "绑定文件夹后，自动用项目自己的图标";
    else if (auto.detected) note = "用项目文件夹里的图标";
    else note = "文件夹里没找到项目的图标，先用默认图标";
  }
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2.5 rounded-lg px-2 py-1.5 ring-1 transition-colors duration-150",
        selected ? "bg-primary/10 ring-primary/60" : "ring-border hover:bg-muted/60",
      )}
    >
      <button type="button" onClick={onPick} aria-pressed={selected} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <EntityIcon icon={auto?.detected ?? ""} fallback={fallback} className="size-5 text-muted-foreground" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1 text-sm font-medium">
            {auto && <Wand className="size-3.5 text-muted-foreground" />}
            {title}
          </span>
          {note && <span className="truncate text-xs text-muted-foreground">{note}</span>}
        </span>
      </button>
      {auto?.onDetect && auto.hasFolder && (
        <Button
          variant="ghost"
          size="xs"
          className="shrink-0 text-muted-foreground"
          disabled={detecting}
          onClick={async () => {
            setDetecting(true);
            await auto.onDetect!();
            setDetecting(false);
          }}
        >
          {detecting ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          重新检测
        </Button>
      )}
    </div>
  );
}

function Tile({ selected, label, onClick, children }: { selected: boolean; label: string; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex size-9 items-center justify-center rounded-md transition-all duration-100 hover:scale-110 hover:bg-muted active:scale-95",
        selected && "bg-primary/15 ring-1 ring-primary/70 hover:bg-primary/20",
      )}
    >
      {children}
    </button>
  );
}

function LucideTab({ value, onPick }: { value: string; onPick(icon: string): void }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BUILTIN_ICONS;
    return BUILTIN_ICONS.filter((i) => i.name.toLowerCase().includes(q) || i.words.toLowerCase().includes(q));
  }, [query]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <label className="flex h-8 shrink-0 items-center gap-2 rounded-md bg-muted/60 px-2.5 text-muted-foreground">
        <Search className="size-3.5 shrink-0" />
        <input
          autoFocus
          value={query}
          maxLength={40}
          spellCheck={false}
          placeholder="搜索图标，比如「游戏」「数据库」"
          aria-label="搜索图标"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <Scroller className="min-h-20 flex-1" viewportClassName="grid grid-cols-9 content-start gap-0.5 p-0.5">
        {shown.map((i) => {
          const icon = `lucide:${i.name}`;
          return (
            <Tile key={i.name} label={i.words.split(" ")[0] ?? i.name} selected={value === icon} onClick={() => onPick(icon)}>
              <i.icon className="size-4.5" />
            </Tile>
          );
        })}
        {shown.length === 0 && <p className="col-span-9 py-8 text-center text-xs text-muted-foreground">没有相符的图标</p>}
      </Scroller>
    </div>
  );
}

function EmojiTab({ value, onPick }: { value: string; onPick(icon: string): void }) {
  const [typed, setTyped] = useState("");
  const ok = isEmoji(typed);
  const use = () => ok && onPick(`emoji:${typed.trim()}`);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex h-8 shrink-0 items-center gap-2 rounded-md bg-muted/60 pr-1 pl-2.5 text-muted-foreground">
        <Smile className="size-3.5 shrink-0" />
        <input
          autoFocus
          value={typed}
          maxLength={24}
          spellCheck={false}
          placeholder="输入或粘贴任意 emoji，回车使用（Win + . 打开表情）"
          aria-label="输入 emoji"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isComposing(e)) {
              e.preventDefault();
              use();
            }
          }}
        />
        {typed && (
          <Button size="xs" variant="ghost" disabled={!ok} onClick={use} className="shrink-0 animate-in fade-in-0">
            使用
          </Button>
        )}
      </div>
      <Scroller className="min-h-20 flex-1" viewportClassName="grid grid-cols-9 content-start gap-0.5 p-0.5">
        {EMOJIS.map((e) => {
          const icon = `emoji:${e}`;
          return (
            <Tile key={e} label={e} selected={value === icon} onClick={() => onPick(icon)}>
              <span className="text-lg leading-none">{e}</span>
            </Tile>
          );
        })}
      </Scroller>
    </div>
  );
}

function ImageTab({ value, fallback, onPick }: { value: string; fallback: LucideIcon; onPick(icon: string): void }) {
  const [busy, setBusy] = useState(false);
  const isImage = parseIcon(value).kind === "image";
  const choose = async () => {
    setBusy(true);
    const icon = await run(Atlas.chooseIconImage());
    setBusy(false);
    if (icon) onPick(icon);
  };
  return (
    <button
      type="button"
      onClick={() => void choose()}
      disabled={busy}
      className="group flex min-h-36 w-full flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-muted-foreground transition-colors duration-150 hover:border-primary/60 hover:bg-muted/40 hover:text-foreground"
    >
      <span className="relative flex size-16 items-center justify-center rounded-xl bg-muted">
        {isImage ? (
          <EntityIcon icon={value} fallback={fallback} className="size-12" />
        ) : (
          <ImagePlus className="size-7 transition-transform duration-200 group-hover:scale-110" />
        )}
      </span>
      <span className="flex items-center gap-1.5 text-sm">
        {busy && <LoaderCircle className="size-3.5 animate-spin" />}
        {isImage ? "换一张图片" : "选择本机图片"}
      </span>
      <span className="text-xs text-muted-foreground">PNG、JPG、WebP、GIF 缩小到 128 像素保存，SVG 原样保存</span>
    </button>
  );
}

interface IconPopoverProps extends Omit<IconPickerProps, "className"> {
  open: boolean;
  onOpenChange(open: boolean): void;
  side?: "right" | "bottom";
  /** The element the picker opens from. */
  children: ReactNode;
}

/**
 * The icon picker in a popover by its trigger: as tall as it fits in the
 * window, its lists scrolling in the rest.
 */
export function IconPopover({ open, onOpenChange, side = "bottom", children, ...picker }: IconPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        collisionPadding={12}
        className="w-auto max-h-(--radix-popover-content-available-height) p-2"
        // Portaled, React still bubbles its events to the row the trigger
        // sits in: they must not open, rename or drag it.
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <IconPicker {...picker} className="shrink basis-[27rem]" />
      </PopoverContent>
    </Popover>
  );
}
