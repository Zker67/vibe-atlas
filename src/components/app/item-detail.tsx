import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft,
  ChevronRight,
  Copy,
  CornerDownRight,
  CornerLeftUp,
  ExternalLink,
  Link2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { Item, ItemStatus, ItemType } from "@/mygo";
import { errorMessage } from "@/lib/api";
import { useDebouncedSave } from "@/lib/debounce";
import { isComposing } from "@/lib/keys";
import { nextType, statusInfo, TYPES, UNSORTED } from "@/lib/labels";
import { formatTime, useNow } from "@/lib/time";
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
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Scroller } from "@/components/ui/scroller";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  copyItem,
  createItem,
  moveItemToProject,
  newChildTaken,
  openDeeplink,
  openLink,
  select,
  setItemDeeplink,
  setItemModule,
  setItemNote,
  setItemStatus,
  setItemTitle,
  setItemType,
  toggleItemDone,
  useAtlas,
} from "@/state/atlas";
import { IconButton } from "./icon-button";
import { StatusButton, TypeChip, TypeIcon } from "./item-marks";
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
          <div className="-mr-1.5 flex shrink-0 items-center gap-0.5 pt-0.5">
            <IconButton label="复制给 AI" shortcut="C" onClick={() => void copyItem(item.id)}>
              <Copy />
            </IconButton>
            <MoveMenu item={item} />
            <IconButton label="删除" shortcut="Delete" className="hover:text-destructive" onClick={() => confirmDeleteItem(item)}>
              <Trash2 />
            </IconButton>
            <IconButton label="关闭" shortcut="Esc" onClick={() => select(0)}>
              <X />
            </IconButton>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusCycle item={item} />
          <TypeSelect item={item} />
          <ModuleSelect item={item} />
        </div>
        <LinkField item={item} />
        <SubItems item={item} />
        <NoteField item={item} />
      </Scroller>
      <Times item={item} />
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

/**
 * The item's children: each opens with a click, its circle marks it done.
 * The field under them adds more, in the item's kind and module.
 */
function SubItems({ item }: { item: Item }) {
  const items = useAtlas((s) => s.items);
  const newChildFor = useAtlas((s) => s.newChildFor);
  const children = useMemo(
    () => buildForest(items).byId.get(item.id)?.children.map((n) => n.item) ?? [],
    [items, item.id],
  );
  const [opened, setOpened] = useState(false);
  // 「添加子改进点」 in the queue's menu opens the field too.
  const adding = opened || newChildFor === item.id;
  const setAdding = (open: boolean) => {
    setOpened(open);
    if (!open && useAtlas.getState().newChildFor === item.id) newChildTaken();
  };
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ItemType>(item.type);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);

  const submit = async () => {
    const text = title.trim();
    if (!text) return;
    setTitle("");
    try {
      await createItem(text, type, item.moduleId, item.id);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
      setTitle((now) => now || text);
    }
  };

  const done = children.filter((c) => c.status === "done").length;
  if (children.length === 0 && !adding) {
    return (
      <Button variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground" onClick={() => setAdding(true)}>
        <CornerDownRight />
        添加子改进点
      </Button>
    );
  }
  return (
    <section aria-label="子改进点" className="flex flex-col gap-1">
      <h3 className="flex h-6 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        子改进点
        {children.length > 0 && (
          <span className="meta-mono">
            {done}/{children.length}
          </span>
        )}
        <IconButton label="添加子改进点" size="icon-xs" className="ml-auto" onClick={() => setAdding(true)}>
          <Plus />
        </IconButton>
      </h3>
      {children.length > 0 && (
        <ul className="-mx-1.5 flex flex-col">
          {children.map((c) => (
            <li key={c.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => select(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") select(c.id);
                }}
                className="flex h-8 cursor-default items-center gap-2 rounded-md px-1.5 transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <StatusButton item={c} onToggle={() => toggleItemDone(c)} />
                <TypeIcon type={c.type} />
                <span className={cn("min-w-0 flex-1 truncate", c.status === "done" && "text-muted-foreground line-through decoration-muted-foreground/40")}>
                  {c.title}
                </span>
                {items.some((i) => i.parentId === c.id) && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="flex flex-col gap-1">
          <div
            className={cn(
              "flex h-8 items-center gap-2 rounded-md border bg-background px-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
              error && "border-destructive",
            )}
          >
            <button type="button" className="shrink-0 rounded-md" title="切换类型（Tab）" onClick={() => setType(nextType(type))}>
              <TypeChip type={type} />
            </button>
            <input
              ref={input}
              value={title}
              maxLength={300}
              placeholder="子改进点的标题，按 Enter 添加"
              aria-label="新子改进点的标题"
              aria-invalid={!!error}
              className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              onChange={(e) => {
                setTitle(e.target.value);
                setError("");
              }}
              onBlur={() => {
                if (!title.trim()) setAdding(false);
              }}
              onKeyDown={(e) => {
                if (isComposing(e)) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                } else if (e.key === "Tab") {
                  e.preventDefault();
                  setType(nextType(type, e.shiftKey));
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setTitle("");
                  setError("");
                  setAdding(false);
                }
              }}
            />
          </div>
          {error && <p className="px-1 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </section>
  );
}

/** The order a click on the status steps through. */
const NEXT_STATUS: Record<ItemStatus, ItemStatus> = { todo: "doing", doing: "done", done: "todo" };

/** The item's status as one button: a click moves it on, 待办 → 进行中 → 完成 → 待办. */
function StatusCycle({ item }: { item: Item }) {
  const at = statusInfo(item.status);
  const next = statusInfo(NEXT_STATUS[item.status]);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`状态：${at.label}，点击改为${next.label}`}
          className="text-sm [&_svg]:size-4"
          onClick={() => void setItemStatus(item.id, next.value)}
        >
          <at.icon className={at.text} />
          {at.label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>点击改为「{next.label}」</TooltipContent>
    </Tooltip>
  );
}

/** Moves the item to another project, picked from a menu. */
function MoveMenu({ item }: { item: Item }) {
  const projects = useAtlas((s) => s.projects);
  const others = projects.filter((p) => p.id !== item.projectId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={others.length ? "移到其他项目" : "没有其他项目可移"} disabled={others.length === 0}>
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
      className="field-sizing-content -mx-1.5 min-w-0 flex-1 resize-none rounded-md bg-transparent px-1.5 py-1 text-base leading-snug font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
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

function TypeSelect({ item }: { item: Item }) {
  return (
    <Select value={item.type} onValueChange={(v) => void setItemType(item.id, v as ItemType)}>
      <SelectTrigger size="sm" aria-label="类型">
        <SelectValue />
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
  return (
    <Select value={String(item.moduleId)} onValueChange={(v) => void setItemModule(item.id, Number(v))}>
      <SelectTrigger size="sm" aria-label="模块" className="max-w-56">
        <SelectValue />
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

/**
 * The link the item is bound to. It saves on Enter or when the field loses
 * the keyboard; a link the app refuses stays in the field, with why.
 */
function LinkField({ item }: { item: Item }) {
  const [draft, setDraft] = useState(item.deeplink);
  const [error, setError] = useState("");
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(item.deeplink);
  }, [item.deeplink]);

  const save = async (value: string) => {
    if (value.trim() === item.deeplink) {
      setDraft(item.deeplink);
      setError("");
      return;
    }
    try {
      const saved = await setItemDeeplink(item.id, value);
      setDraft(saved.deeplink);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <InputGroup className="h-8">
        <InputGroupAddon>
          <Link2 />
        </InputGroupAddon>
        <InputGroupInput
          value={draft}
          placeholder="可选：绑定一个链接，比如 AI 对话、文档或本地文件"
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
        {item.deeplink && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="打开链接" title="打开链接（O）" onClick={() => openDeeplink(item.id)}>
              <ExternalLink />
            </InputGroupButton>
            <InputGroupButton
              size="icon-xs"
              aria-label="解除链接"
              title="解除链接"
              onClick={() => {
                setDraft("");
                void save("");
              }}
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        )}
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
    <MarkdownEditor
      value={item.note}
      className="mb-3 min-h-40 flex-1 rounded-lg border px-2.5 py-1.5 transition-colors hover:border-ring/60 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30"
      placeholder="备注：用 Markdown 写，边写边预览"
      onChange={schedule}
      onBlur={flush}
      onOpenLink={openLink}
    />
  );
}

function Times({ item }: { item: Item }) {
  const now = useNow();
  const parts = [`创建于 ${formatTime(item.createdAt, now)}`];
  if (item.startedAt) parts.push(`开始于 ${formatTime(item.startedAt, now)}`);
  if (item.doneAt) parts.push(`完成于 ${formatTime(item.doneAt, now)}`);
  return <p className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">{parts.join(" · ")}</p>;
}
