import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AppWindow,
  ArrowRightLeft,
  ChevronRight,
  CircleDashed,
  Clock,
  Copy,
  CornerLeftUp,
  FileText,
  Folder,
  Globe,
  Link2,
  NotebookPen,
  Pencil,
  Plus,
  Shapes,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Item, ItemStatus, ItemType } from "@/mygo";
import { errorMessage } from "@/lib/api";
import { useDebouncedSave } from "@/lib/debounce";
import { isComposing } from "@/lib/keys";
import { statusInfo, STATUSES, TYPES, UNSORTED } from "@/lib/labels";
import { duration, formatTime, fullTime, useNow } from "@/lib/time";
import { ancestors, buildForest } from "@/lib/tree";
import { cn } from "@/lib/utils";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Scroller } from "@/components/ui/scroller";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  copyItem,
  moveItemToProject,
  openDeeplink,
  openLink,
  select,
  setItemDeeplink,
  setItemModule,
  setItemNote,
  setItemStatus,
  setItemTitle,
  setItemType,
  useAtlas,
} from "@/state/atlas";
import { IconButton } from "./icon-button";
import { TypeChip } from "./item-marks";
import { confirmDeleteItem } from "./queue";

/** The panel beside the queue: the selected item, to edit. */
export function ItemDetail() {
  const item = useAtlas((s) => s.items.find((i) => i.id === s.selectedId));
  if (!item) return <DetailEmpty />;
  // A new key per item: the fields and the editor start over with its text.
  return <Detail key={item.id} item={item} />;
}

const KEYS: [string, string][] = [
  ["↑ ↓", "选择上一条、下一条"],
  ["Space", "标为完成，或重新打开"],
  ["S", "开始进行，或退回待办"],
  ["C", "复制给 AI"],
  ["O", "打开链接"],
  ["Enter", "编辑标题"],
  ["Delete", "删除"],
  ["N", "新增一条"],
];

function DetailEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-muted-foreground">
      <p>选中一条改进点，在这里补充备注和链接。</p>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
        {KEYS.map(([key, what]) => (
          <div key={key} className="contents">
            <dt className="justify-self-end">
              <Kbd>{key}</Kbd>
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Detail({ item }: { item: Item }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Scroller className="flex-1" viewportClassName="flex flex-col gap-3 px-4 pt-3">
        {item.parentId !== 0 && <ParentPath item={item} />}
        <div className="flex items-start gap-2">
          <TitleField item={item} />
          <div className="-mr-1.5 flex shrink-0 items-center gap-0.5 pt-1">
            <IconButton label="复制给 AI" shortcut="C" onClick={() => void copyItem(item.id)}>
              <Copy />
            </IconButton>
            <MoveMenu item={item} />
            <IconButton label="删除" shortcut="Delete" className="hover:text-destructive" onClick={() => confirmDeleteItem(item)}>
              <Trash2 />
            </IconButton>
            <span aria-hidden className="mx-1 h-4 w-px bg-border" />
            <IconButton label="关闭" shortcut="Esc" onClick={() => select(0)}>
              <X />
            </IconButton>
          </div>
        </div>
        <dl className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 pb-1">
          <Prop label="状态" icon={CircleDashed}>
            <StatusSegments item={item} />
          </Prop>
          <Prop label="类型" icon={Shapes}>
            <TypeSelect item={item} />
          </Prop>
          <Prop label="模块" icon={Folder}>
            <ModuleSelect item={item} />
          </Prop>
          <Prop label="链接" icon={Link2}>
            <LinkField item={item} />
          </Prop>
          <Prop label="时间" icon={Clock} top>
            <Timeline item={item} />
          </Prop>
        </dl>
        <NoteField item={item} />
      </Scroller>
    </div>
  );
}

/** One row of the properties: its name, faint, on the left; its value on the right. */
function Prop({ label, icon: Icon, top, children }: { label: string; icon: LucideIcon; top?: boolean; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className={cn("flex h-7 items-center gap-1.5 text-xs text-muted-foreground", top && "self-start")}>
        <Icon className="size-3.5 shrink-0" />
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** The items above this one, the top-level one first; a click opens one. */
function ParentPath({ item }: { item: Item }) {
  const items = useAtlas((s) => s.items);
  const path = useMemo(() => ancestors(buildForest(items), item.id), [items, item.id]);
  if (path.length === 0) return null;
  return (
    <nav aria-label="上级改进点" className="-mb-2 flex min-w-0 items-center gap-0.5 text-xs text-muted-foreground">
      <CornerLeftUp className="mr-1 size-3 shrink-0" />
      {path.map((p, i) => (
        <span key={p.id} className="flex min-w-0 items-center gap-0.5">
          {i > 0 && <ChevronRight className="size-3 shrink-0 opacity-60" />}
          <button
            type="button"
            onClick={() => select(p.id)}
            className="max-w-48 truncate rounded-sm px-1 py-0.5 hover:bg-accent hover:text-foreground"
          >
            {p.title}
          </button>
        </span>
      ))}
    </nav>
  );
}

/** The signal color each status fills its segment with. */
const STATUS_CHIP: Record<ItemStatus, string> = {
  todo: "[--chip:var(--muted-foreground)]",
  doing: "[--chip:var(--doing)]",
  done: "[--chip:var(--done)]",
};

/** The item's status as three segments, 待办 | 进行中 | 完成: a click picks one. */
function StatusSegments({ item }: { item: Item }) {
  return (
    <div role="group" aria-label="状态" className="inline-flex h-7 max-w-full items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {STATUSES.map((s) => {
        const on = s.value === item.status;
        return (
          <button
            key={s.value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              if (!on) void setItemStatus(item.id, s.value);
            }}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] duration-200 hover:bg-background/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              on && cn("signal-chip hover:bg-transparent", STATUS_CHIP[s.value]),
            )}
          >
            <s.icon className={cn("size-3.5 transition-opacity", !on && "opacity-60")} />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * When the item was made, started and done, as a small timeline: each step
 * with how long it took since the one before, and how long it has been
 * going while it is in progress. A time shows in full under the pointer.
 */
function Timeline({ item }: { item: Item }) {
  const now = useNow();
  const steps: { label: string; at: number; icon: LucideIcon; text: string; note?: string }[] = [
    { label: "创建", at: item.createdAt, icon: statusInfo("todo").icon, text: "text-muted-foreground" },
  ];
  if (item.startedAt) {
    steps.push({ ...STEP_LOOK.doing, label: "开始", at: item.startedAt, note: `等了 ${duration(item.createdAt, item.startedAt)}` });
  }
  if (item.doneAt) {
    const from = item.startedAt || item.createdAt;
    steps.push({ ...STEP_LOOK.done, label: "完成", at: item.doneAt, note: `${item.startedAt ? "用时" : "历时"} ${duration(from, item.doneAt)}` });
  } else if (item.status === "doing" && item.startedAt) {
    steps.push({ label: "现在", at: 0, icon: CircleDashed, text: "text-doing", note: `已进行 ${duration(item.startedAt, now)}` });
  }

  return (
    <ol aria-label="时间" className="flex flex-col text-xs">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex h-7 items-center gap-2 px-1.5">
          {i < steps.length - 1 && <span aria-hidden className="absolute top-[22px] left-[12.5px] h-3 w-px bg-border" />}
          <s.icon className={cn("size-3.5 shrink-0", s.text)} />
          <span className="shrink-0 text-muted-foreground">{s.label}</span>
          {s.at > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <time dateTime={new Date(s.at).toISOString()} className="meta-mono shrink-0 text-foreground/90">
                  {formatTime(s.at, now)}
                </time>
              </TooltipTrigger>
              <TooltipContent className="meta-mono">{fullTime(s.at)}</TooltipContent>
            </Tooltip>
          )}
          {s.note && <span className="ml-auto min-w-0 truncate text-muted-foreground">{s.note}</span>}
        </li>
      ))}
    </ol>
  );
}

const STEP_LOOK = {
  doing: { icon: statusInfo("doing").icon, text: statusInfo("doing").text },
  done: { icon: statusInfo("done").icon, text: statusInfo("done").text },
};

/** Moves the item to another project, picked from a menu; gone when there is none. */
function MoveMenu({ item }: { item: Item }) {
  const projects = useAtlas((s) => s.projects);
  const others = projects.filter((p) => p.id !== item.projectId);
  if (others.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="移到其他项目">
          <ArrowRightLeft />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-48 overflow-y-auto">
        <DropdownMenuLabel>移到其他项目</DropdownMenuLabel>
        {others.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => void moveItemToProject(item.id, p.id)}>
            <span className="truncate">{p.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The title, edited in place: Enter saves, Escape gives the edit up. */
function TitleField({ item }: { item: Item }) {
  const [draft, setDraft] = useState(item.title);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(item.title);
  }, [item.title]);

  const save = () => {
    const text = draft.trim();
    if (!text || text === item.title) {
      setDraft(item.title);
      return;
    }
    void setItemTitle(item.id, text).then((saved) => setDraft(saved?.title ?? item.title));
  };

  return (
    <textarea
      data-item-title
      value={draft}
      rows={1}
      maxLength={300}
      aria-label="标题"
      className="field-sizing-content -mx-1.5 min-w-0 flex-1 resize-none rounded-md bg-transparent px-1.5 py-1 text-lg leading-snug font-semibold outline-none transition-[background-color,box-shadow] duration-200 hover:bg-muted/60 focus-visible:bg-transparent focus-visible:ring-3 focus-visible:ring-ring/30"
      onFocus={() => (editing.current = true)}
      onBlur={() => {
        editing.current = false;
        save();
      }}
      onChange={(e) => setDraft(e.target.value.replace(/\s*\n\s*/g, " "))}
      onKeyDown={(e) => {
        if (isComposing(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(item.title);
          editing.current = false;
          // Blur after React applied the reverted text, so nothing saves.
          const el = e.currentTarget;
          requestAnimationFrame(() => el.blur());
        }
      }}
    />
  );
}

/** A select that reads as its value, and shows it is one under the pointer. */
const QUIET_TRIGGER =
  "h-7 max-w-full border-transparent bg-transparent px-1.5 hover:bg-muted aria-expanded:bg-muted dark:bg-transparent dark:hover:bg-muted [&>svg:last-child]:opacity-50";

function TypeSelect({ item }: { item: Item }) {
  return (
    <Select value={item.type} onValueChange={(v) => void setItemType(item.id, v as ItemType)}>
      <SelectTrigger size="sm" aria-label="类型" className={QUIET_TRIGGER}>
        <SelectValue>
          <TypeChip type={item.type} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {TYPES.map((t) => (
          <SelectItem key={t.value} value={t.value}>
            <t.icon className={t.text} />
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ModuleSelect({ item }: { item: Item }) {
  const modules = useAtlas((s) => s.modules);
  const name = modules.find((m) => m.id === item.moduleId)?.name;
  return (
    <Select value={String(item.moduleId)} onValueChange={(v) => void setItemModule(item.id, Number(v))}>
      <SelectTrigger size="sm" aria-label="模块" className={QUIET_TRIGGER}>
        <SelectValue>{name ? <span className="truncate">{name}</span> : <span className="text-muted-foreground">选择模块</span>}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="0">{UNSORTED}</SelectItem>
        {modules.map((m) => (
          <SelectItem key={m.id} value={String(m.id)}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function decoded(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** How a link shows: a web link as its site and path, a local file as its name, others as they are. */
function linkLook(link: string): { icon: LucideIcon; text: string } {
  if (/^file:/i.test(link)) {
    const path = decoded(link.replace(/^file:\/*/i, "")).replace(/\/+$/, "");
    return { icon: FileText, text: path.split("/").pop() || path };
  }
  if (/^https?:/i.test(link)) {
    try {
      const u = new URL(link);
      return { icon: Globe, text: u.host + decoded(u.pathname.replace(/\/$/, "")) };
    } catch {
      // Not a URL the browser reads: shown as it is.
    }
  }
  return { icon: AppWindow, text: link };
}

/**
 * The link the item is bound to. Unbound, it is a faint 「添加链接」; bound,
 * a card that opens it, with edit and unbind under the pointer. The field
 * saves on Enter or when it loses the keyboard; a link the app refuses
 * stays in the field, with why.
 */
function LinkField({ item }: { item: Item }) {
  const [draft, setDraft] = useState(item.deeplink);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(item.deeplink);
  }, [item.deeplink]);

  const save = async (value: string) => {
    if (value.trim() === item.deeplink) {
      setDraft(item.deeplink);
      setError("");
      setOpen(false);
      return;
    }
    try {
      const saved = await setItemDeeplink(item.id, value);
      setDraft(saved.deeplink);
      setError("");
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (!open && !error) {
    if (!item.deeplink) {
      return (
        <Button variant="ghost" size="sm" className="h-7 px-1.5 font-normal text-muted-foreground" onClick={() => setOpen(true)}>
          <Plus />
          添加链接
        </Button>
      );
    }
    const look = linkLook(item.deeplink);
    return (
      <div className="group/link relative flex min-w-0 items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => openDeeplink(item.id)}
              className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 pr-14 text-left transition-colors duration-200 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <look.icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{look.text}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-80 break-all">
            打开 {item.deeplink}
            <span className="ml-1.5 opacity-60">O</span>
          </TooltipContent>
        </Tooltip>
        <div className="absolute right-0.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-focus-within/link:opacity-100 group-hover/link:opacity-100">
          <IconButton size="icon-xs" label="编辑链接" onClick={() => setOpen(true)}>
            <Pencil />
          </IconButton>
          <IconButton
            size="icon-xs"
            label="解除链接"
            onClick={() => {
              setDraft("");
              void save("");
            }}
          >
            <X />
          </IconButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <InputGroup className="h-7">
        <InputGroupInput
          autoFocus
          value={draft}
          placeholder="AI 对话、网页或本地文件的链接"
          aria-label="链接"
          aria-invalid={!!error}
          spellCheck={false}
          onFocus={() => (editing.current = true)}
          onBlur={() => {
            editing.current = false;
            void save(draft);
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (isComposing(e)) return;
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(item.deeplink);
              setError("");
              editing.current = false;
              const el = e.currentTarget;
              requestAnimationFrame(() => el.blur());
            }
          }}
        />
      </InputGroup>
      {error && <p className="px-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** The notes, in the live preview editor; they save as the user pauses. */
function NoteField({ item }: { item: Item }) {
  const { schedule, flush } = useDebouncedSave((note) => {
    // The item may be gone meanwhile, deleted or moved to another project.
    if (useAtlas.getState().items.some((i) => i.id === item.id)) void setItemNote(item.id, note);
  });

  return (
    <section aria-label="备注" className="mb-3 flex min-h-40 flex-1 flex-col gap-1">
      <h3 className="flex h-6 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <NotebookPen className="size-3.5" />
        备注
      </h3>
      <MarkdownEditor
        value={item.note}
        className="-mx-2.5 flex-1 rounded-lg border border-transparent px-2.5 py-1.5 transition-[background-color,border-color,box-shadow] duration-200 hover:bg-muted/50 focus-within:border-ring focus-within:bg-transparent focus-within:ring-3 focus-within:ring-ring/30"
        placeholder="用 Markdown 写，边写边预览"
        onChange={schedule}
        onBlur={flush}
        onOpenLink={openLink}
      />
    </section>
  );
}
