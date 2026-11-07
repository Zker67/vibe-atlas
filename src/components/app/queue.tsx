import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import {
  ArrowRightLeft,
  Boxes,
  ChevronRight,
  CircleCheck,
  CircleDot,
  Copy,
  ExternalLink,
  FileText,
  Inbox,
  Link2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { Item, ItemStatus, ItemType } from "@/mygo";
import { cn } from "@/lib/utils";
import { isComposing } from "@/lib/keys";
import { nextType, UNSORTED } from "@/lib/labels";
import { elapsed, formatTime, useNow } from "@/lib/time";
import { errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  clearFilters,
  copyItem,
  createItem,
  deleteItem,
  matchesFilters,
  matchesStatus,
  moveItemToProject,
  moveTodoItem,
  openDeeplink,
  sections,
  select,
  setItemModule,
  setItemStatus,
  toggleDone,
  toggleItemDoing,
  toggleItemDone,
  useAtlas,
  type Sections,
  type StatusFilter,
} from "@/state/atlas";
import { askConfirm } from "@/state/dialogs";
import { IconButton } from "./icon-button";
import { StatusButton, TypeChip, TypeIcon } from "./item-marks";
import { SortableList, SortableRow } from "./sortable";

const DONE_PAGE = 50;

/** What only the queue's page keeps: the row just added, how much of done shows. */
const useQueueUi = create<{ flashId: number; doneLimit: number }>(() => ({ flashId: 0, doneLimit: DONE_PAGE }));

let flashTimer = 0;
function flashRow(id: number) {
  useQueueUi.setState({ flashId: id });
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => useQueueUi.setState({ flashId: 0 }), 1200);
}

/** The rows the queue shows now, top to bottom: for the keys that move the selection. */
export function visibleItems(): Item[] {
  const s = useAtlas.getState();
  const { doing, todo, done } = shownSections(sections(s.items, s.typeFilter, s.moduleFilter), s.statusFilter);
  const doneShown = s.statusFilter === "done" || s.doneOpen;
  return [...doing, ...todo, ...(doneShown ? done.slice(0, useQueueUi.getState().doneLimit) : [])];
}

/** The sections, emptied of the statuses that the status filter hides. */
function shownSections(all: Sections, statusFilter: StatusFilter): Sections {
  const show = (st: ItemStatus) => statusFilter === "all" || statusFilter === st;
  return { doing: show("doing") ? all.doing : [], todo: show("todo") ? all.todo : [], done: show("done") ? all.done : [] };
}

export function confirmDeleteItem(item: Item) {
  askConfirm({
    title: `删除「${item.title}」？`,
    description: "删除后无法恢复。",
    confirmText: "删除",
    destructive: true,
    onConfirm: () => deleteItem(item.id),
  });
}

export function Queue() {
  const items = useAtlas((s) => s.items);
  const modules = useAtlas((s) => s.modules);
  const typeFilter = useAtlas((s) => s.typeFilter);
  const moduleFilter = useAtlas((s) => s.moduleFilter);
  const statusFilter = useAtlas((s) => s.statusFilter);
  const selectedId = useAtlas((s) => s.selectedId);
  const doneOpen = useAtlas((s) => s.doneOpen);
  const flashId = useQueueUi((s) => s.flashId);
  const doneLimit = useQueueUi((s) => s.doneLimit);

  const { doing, todo, done } = useMemo(
    () => shownSections(sections(items, typeFilter, moduleFilter), statusFilter),
    [items, typeFilter, moduleFilter, statusFilter],
  );
  const moduleNames = useMemo(() => new Map(modules.map((m) => [m.id, m.name])), [modules]);
  // The module shows on each row unless the queue shows one module only.
  const moduleOf = (item: Item) => (moduleFilter === "all" ? (moduleNames.get(item.moduleId) ?? "") : "");
  const row = (item: Item) => (
    <ItemRow key={item.id} item={item} moduleName={moduleOf(item)} selected={item.id === selectedId} flash={item.id === flashId} />
  );

  const filtered = typeFilter !== "all" || moduleFilter !== "all" || statusFilter !== "all";
  const nothing = doing.length + todo.length + done.length === 0;
  const doneList = (
    <div className="flex flex-col">
      {done.slice(0, doneLimit).map(row)}
      {done.length > doneLimit && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 self-start text-muted-foreground"
          onClick={() => useQueueUi.setState({ doneLimit: doneLimit + DONE_PAGE })}
        >
          再显示 {Math.min(DONE_PAGE, done.length - doneLimit)} 条
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) select(0);
        }}
      >
        {nothing ? (
          <QueueEmpty filtered={filtered && items.length > 0} />
        ) : (
          <>
            {doing.length > 0 && (
              <Section icon={<CircleDot className="size-3.5 text-doing" />} title="进行中" count={doing.length}>
                {doing.map(row)}
              </Section>
            )}
            {(statusFilter === "all" || statusFilter === "todo") && (
              <Section title="待办" count={todo.length}>
                {todo.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">没有待办了。</p>
                ) : (
                  <SortableList ids={todo.map((i) => i.id)} onMove={moveTodoItem}>
                    {todo.map((item) => (
                      <SortableRow key={item.id} id={item.id}>
                        {row(item)}
                      </SortableRow>
                    ))}
                  </SortableList>
                )}
              </Section>
            )}
            {statusFilter === "done" && (
              <Section icon={<CircleCheck className="size-3.5 text-done" />} title="已完成" count={done.length}>
                {doneList}
              </Section>
            )}
            {statusFilter === "all" && done.length > 0 && (
              <section className="mt-2">
                <button
                  type="button"
                  onClick={() => toggleDone()}
                  className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight className={cn("size-3.5 transition-transform duration-150", doneOpen && "rotate-90")} />
                  已完成
                  <span className="meta-mono">{done.length}</span>
                </button>
                {doneOpen && doneList}
              </section>
            )}
          </>
        )}
      </div>
      <NewItemInput />
    </div>
  );
}

function Section({ icon, title, count, children }: { icon?: ReactNode; title: string; count: number; children: ReactNode }) {
  return (
    <section className="mb-2">
      <h2 className="flex h-7 items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
        {icon}
        {title}
        <span className="meta-mono">{count}</span>
      </h2>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function QueueEmpty({ filtered }: { filtered: boolean }) {
  const shortcut = useAtlas((s) => s.settings?.shortcut);
  if (filtered) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        <p>没有符合筛选条件的改进点。</p>
        <Button variant="outline" size="sm" onClick={clearFilters}>
          清除筛选
        </Button>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <Inbox className="mb-1 size-8 opacity-50" />
      <p className="text-foreground">这里还没有改进点</p>
      <p>在下面输入标题，按 Enter 记下一条。</p>
      {shortcut && <p>在任何地方按 {shortcut}，也能快速记录。</p>}
    </div>
  );
}

// ---- A row ----

interface ItemRowProps {
  item: Item;
  /** The module's name to show, or "" to show none. */
  moduleName: string;
  selected: boolean;
  flash: boolean;
}

const ItemRow = memo(function ItemRow({ item, moduleName, selected, flash }: ItemRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected || flash) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected, flash]);
  const done = item.status === "done";

  return (
    <ContextMenu onOpenChange={(open) => open && select(item.id)}>
      <ContextMenuTrigger asChild>
        <div
          ref={ref}
          data-item-id={item.id}
          aria-current={selected || undefined}
          onClick={() => select(item.id)}
          className={cn(
            "signal-row group flex h-9 items-center gap-2 rounded-md px-2 transition-colors duration-100",
            selected ? "bg-accent" : "hover:bg-accent/50",
            flash && "row-flash",
          )}
        >
          <StatusButton item={item} onToggle={() => toggleItemDone(item)} />
          <TypeIcon type={item.type} />
          <span className={cn("min-w-0 flex-1 truncate", done && "text-muted-foreground")}>{item.title}</span>
          {moduleName && (
            <span className="max-w-32 shrink-0 truncate rounded-sm bg-muted px-1.5 text-xs leading-5 text-muted-foreground">
              {moduleName}
            </span>
          )}
          {item.note.trim() && <FileText aria-label="有备注" className="size-3.5 shrink-0 text-muted-foreground" />}
          {item.deeplink && <LinkMark item={item} />}
          <RowTime item={item} />
          {!done && <RowActions item={item} shown={selected} />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ItemMenuItems item={item} />
      </ContextMenuContent>
    </ContextMenu>
  );
});

function LinkMark({ item }: { item: Item }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="打开链接"
          onClick={(e) => {
            e.stopPropagation();
            openDeeplink(item.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <Link2 className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 break-all">
        {item.deeplink}
        <span className="ml-1.5 shrink-0 opacity-60">O</span>
      </TooltipContent>
    </Tooltip>
  );
}

function RowTime({ item }: { item: Item }) {
  const now = useNow();
  let text = "";
  if (item.status === "doing" && item.startedAt) {
    const e = elapsed(item.startedAt, now);
    text = e === "刚刚" ? "刚开始" : `进行了 ${e}`;
  } else if (item.status === "done") {
    text = formatTime(item.doneAt, now);
  }
  if (!text) return null;
  return <span className="meta-mono shrink-0 text-muted-foreground">{text}</span>;
}

function RowActions({ item, shown }: { item: Item; shown: boolean }) {
  const doing = item.status === "doing";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100",
        shown && "opacity-100",
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <IconButton
        label={doing ? "退回待办" : "开始进行"}
        shortcut="S"
        size="icon-xs"
        onClick={(e) => {
          e.stopPropagation();
          toggleItemDoing(item);
        }}
      >
        {doing ? <Pause /> : <Play />}
      </IconButton>
      <IconButton
        label="复制给 AI"
        shortcut="C"
        size="icon-xs"
        onClick={(e) => {
          e.stopPropagation();
          void copyItem(item.id);
        }}
      >
        <Copy />
      </IconButton>
    </div>
  );
}

interface StatusAction {
  label: string;
  status: ItemStatus;
  icon: typeof Play;
  shortcut: string;
}

/** What an item's status can become, with the keys that do it. */
export function statusActions(item: Item): StatusAction[] {
  switch (item.status) {
    case "todo":
      return [
        { label: "开始进行", status: "doing", icon: Play, shortcut: "S" },
        { label: "标为完成", status: "done", icon: CircleCheck, shortcut: "Space" },
      ];
    case "doing":
      return [
        { label: "标为完成", status: "done", icon: CircleCheck, shortcut: "Space" },
        { label: "退回待办", status: "todo", icon: Pause, shortcut: "S" },
      ];
    case "done":
      return [
        { label: "重新打开", status: "todo", icon: RotateCcw, shortcut: "Space" },
        { label: "重新开始进行", status: "doing", icon: Play, shortcut: "" },
      ];
  }
}

/** What the right-click menu of a row offers. It mounts only while the menu is open. */
function ItemMenuItems({ item }: { item: Item }) {
  const projects = useAtlas((s) => s.projects);
  const modules = useAtlas((s) => s.modules);
  const others = projects.filter((p) => p.id !== item.projectId);
  return (
    <>
      {statusActions(item).map((a) => (
        <ContextMenuItem key={a.status} onSelect={() => void setItemStatus(item.id, a.status)}>
          <a.icon />
          {a.label}
          {a.shortcut && <ContextMenuShortcut>{a.shortcut}</ContextMenuShortcut>}
        </ContextMenuItem>
      ))}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => void copyItem(item.id)}>
        <Copy />
        复制给 AI
        <ContextMenuShortcut>C</ContextMenuShortcut>
      </ContextMenuItem>
      {item.deeplink && (
        <ContextMenuItem onSelect={() => openDeeplink(item.id)}>
          <ExternalLink />
          打开链接
          <ContextMenuShortcut>O</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Boxes />
          移到模块
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-80 w-44 overflow-y-auto">
          <ContextMenuRadioGroup value={String(item.moduleId)} onValueChange={(v) => void setItemModule(item.id, Number(v))}>
            <ContextMenuRadioItem value="0">{UNSORTED}</ContextMenuRadioItem>
            {modules.map((m) => (
              <ContextMenuRadioItem key={m.id} value={String(m.id)}>
                <span className="truncate">{m.name}</span>
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={others.length === 0}>
          <ArrowRightLeft />
          移到其他项目
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-80 w-48 overflow-y-auto">
          {others.map((p) => (
            <ContextMenuItem key={p.id} onSelect={() => void moveItemToProject(item.id, p.id)}>
              <span className="truncate">{p.name}</span>
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => confirmDeleteItem(item)}>
        <Trash2 />
        删除
        <ContextMenuShortcut>Delete</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );
}

// ---- Adding ----

/** The field under the queue: a title and Enter add an item to do. */
function NewItemInput() {
  const typeFilter = useAtlas((s) => s.typeFilter);
  const moduleFilter = useAtlas((s) => s.moduleFilter);
  const modules = useAtlas((s) => s.modules);
  const focusSignal = useAtlas((s) => s.focusNewItem);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ItemType>(typeFilter === "all" ? "improve" : typeFilter);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // New items take the kind and the module the queue shows.
  const [seenFilter, setSeenFilter] = useState(typeFilter);
  if (typeFilter !== seenFilter) {
    setSeenFilter(typeFilter);
    if (typeFilter !== "all") setType(typeFilter);
  }
  useEffect(() => {
    if (focusSignal) input.current?.focus();
  }, [focusSignal]);

  const moduleId = typeof moduleFilter === "number" ? moduleFilter : 0;
  const moduleName = moduleFilter === "all" ? "" : moduleFilter === 0 ? UNSORTED : (modules.find((m) => m.id === moduleFilter)?.name ?? "");

  // The field clears at once, so the next title can follow without waiting;
  // a title that failed to save comes back unless another was typed since.
  const submit = async () => {
    const text = title.trim();
    if (!text) return;
    setTitle("");
    try {
      const item = await createItem(text, type, moduleId);
      setError("");
      const s = useAtlas.getState();
      if (matchesFilters(item, s.typeFilter, s.moduleFilter) && matchesStatus(item, s.statusFilter)) {
        flashRow(item.id);
      } else {
        toast("已记下，但当前筛选不显示它", { action: { label: "清除筛选", onClick: clearFilters } });
      }
    } catch (e) {
      setError(errorMessage(e));
      setTitle((now) => now || text);
    }
  };

  return (
    <div className="shrink-0 border-t px-3 py-2.5">
      <div
        className={cn(
          "group/new flex h-9 items-center gap-2 rounded-lg border bg-background px-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
          error && "border-destructive",
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="shrink-0 rounded-md" onClick={() => setType(nextType(type))}>
              <TypeChip type={type} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            切换类型<span className="ml-1.5 opacity-60">Tab</span>
          </TooltipContent>
        </Tooltip>
        <input
          ref={input}
          value={title}
          maxLength={300}
          placeholder="记一条改进点，按 Enter 保存"
          aria-label="新改进点的标题"
          aria-invalid={!!error}
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          onChange={(e) => {
            setTitle(e.target.value);
            setError("");
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
              setError("");
              input.current?.blur();
            }
          }}
        />
        {moduleName && (
          <span className="flex max-w-40 shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Boxes className="size-3 shrink-0" />
            <span className="truncate">{moduleName}</span>
          </span>
        )}
        <Kbd className="group-focus-within/new:hidden">N</Kbd>
      </div>
      {error && <p className="mt-1 px-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
