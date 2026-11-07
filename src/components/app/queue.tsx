import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useSensor, useSensors, type DragStartEvent } from "@dnd-kit/core";
import {
  ArrowRightLeft,
  Boxes,
  ChevronRight,
  CircleCheck,
  CircleDot,
  Combine,
  Copy,
  CornerDownRight,
  CornerLeftUp,
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
import { buildForest, subtreeIds, type Row, type TreeRows } from "@/lib/tree";
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
  dropItem,
  focusNewChild,
  layoutQueue,
  matchesFilters,
  matchesStatus,
  mergeItems,
  moveItem,
  moveItemToProject,
  openDeeplink,
  select,
  setCollapsed,
  setItemModule,
  setItemStatus,
  setSectionOpen,
  statusChanges,
  toggleCollapsed,
  toggleItemDoing,
  toggleItemDone,
  useAtlas,
} from "@/state/atlas";
import { askConfirm } from "@/state/dialogs";
import { IconButton } from "./icon-button";
import { StatusButton, TypeChip, TypeIcon } from "./item-marks";

const DONE_PAGE = 50;

/** How far each level of sub-items sits to the right, in pixels. */
const INDENT = 20;
/** The row's left padding, in pixels (px-2). */
const PAD = 8;

/** What only the queue's page keeps: the row just added, how much of done shows. */
const useQueueUi = create<{ flashId: number; doneLimit: number }>(() => ({ flashId: 0, doneLimit: DONE_PAGE }));

let flashTimer = 0;
function flashRow(id: number) {
  useQueueUi.setState({ flashId: id });
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => useQueueUi.setState({ flashId: 0 }), 1200);
}

type QueueLayoutState = Pick<
  ReturnType<typeof useAtlas.getState>,
  "items" | "typeFilter" | "moduleFilter" | "statusFilter" | "collapsed" | "sectionOpen"
>;

/** Whether a section of the queue shows its rows: the one the status filter picks, else as the user left it. */
function sectionShown(s: Pick<QueueLayoutState, "statusFilter" | "sectionOpen">, section: ItemStatus): boolean {
  return s.statusFilter === section || (s.statusFilter === "all" && s.sectionOpen[section]);
}

/** The trees each section shows now, 进行中, 待办, 已完成: none for a closed section, done a page at a time. */
function shownTrees(s: QueueLayoutState, doneLimit: number): TreeRows[][] {
  const t = layoutQueue(s);
  return [
    sectionShown(s, "doing") ? t.doing : [],
    sectionShown(s, "todo") ? t.todo : [],
    sectionShown(s, "done") ? t.done.slice(0, doneLimit) : [],
  ];
}

/** The rows the queue shows now, top to bottom: for the keys that move the selection. */
function visibleRows(): Row[] {
  return shownTrees(useAtlas.getState(), useQueueUi.getState().doneLimit).flatMap((list) => list.flatMap((t) => t.rows));
}

export function visibleItems(): Item[] {
  return visibleRows().map((r) => r.item);
}

/** ←: hides the selected item's children, or moves to its parent. */
export function collapseOrUp() {
  const { selectedId } = useAtlas.getState();
  const row = visibleRows().find((r) => r.item.id === selectedId);
  if (!row) return;
  if (row.hasChildren && !row.collapsed) setCollapsed(row.item.id, true);
  else if (row.item.parentId) select(row.item.parentId);
}

/** →: shows the selected item's children, or moves to the first of them. */
export function expandOrDown() {
  const { selectedId } = useAtlas.getState();
  const rows = visibleRows();
  const at = rows.findIndex((r) => r.item.id === selectedId);
  const row = rows[at];
  if (!row?.hasChildren) return;
  if (row.collapsed) setCollapsed(row.item.id, false);
  else if (rows[at + 1]) select(rows[at + 1]!.item.id);
}

export function confirmDeleteItem(item: Item) {
  const children = buildForest(useAtlas.getState().items).byId.get(item.id)?.children.length ?? 0;
  askConfirm({
    title: `删除「${item.title}」？`,
    description: children ? `删除后无法恢复。它的 ${children} 个子改进点会上移一层，不会被删除。` : "删除后无法恢复。",
    confirmText: "删除",
    destructive: true,
    onConfirm: () => deleteItem(item.id),
  });
}

// ---- Dragging ----

/**
 * Where a dragged item lands on a row: before or after it, as its sibling;
 * merged with it under a new parent; or inside it, when it already has
 * children.
 */
type Zone = "before" | "after" | "merge" | "inside";

/**
 * Where a drag would land: on a row, with the status it takes there when
 * that changes; or on a section, whose status it takes.
 */
type Drop =
  | { kind: "row"; overId: number; zone: Zone; status: ItemStatus | null; count: number }
  | { kind: "section"; section: ItemStatus; count: number };

function sameDrop(a: Drop | null, b: Drop | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "section") return b.kind === "section" && a.section === b.section && a.count === b.count;
  if (b.kind === "section") return false;
  return a.overId === b.overId && a.zone === b.zone && a.status === b.status && a.count === b.count;
}

/** The drag under way: the item dragged, it and what is under it, where it would land. */
const useDrag = create<{ active: Item | null; moving: ReadonlySet<number>; drop: Drop | null }>(() => ({
  active: null,
  moving: new Set(),
  drop: null,
}));

/** What the drop needs to know of a row the queue shows. */
interface RowInfo {
  row: Row;
  section: ItemStatus;
  /** The row right under it, if in the same tree. */
  next: Row | undefined;
}

/** What the queue shows, as the drop reads it. */
interface DropMap {
  rows: Map<number, RowInfo>;
  /** The first top-level item to do. */
  firstTodo: number;
}

/**
 * What dropping the item on a section does; null when nothing changes.
 * The item takes the section's status, with what statusChanges picks under
 * it; a top-level item dropped on 待办 also goes first among the items to do.
 */
function sectionDrop(active: Item, section: ItemStatus): Drop | null {
  const count = statusChanges(useAtlas.getState().items, active.id, section).length;
  if (count === 0 && (section !== "todo" || active.parentId !== 0)) return null;
  return { kind: "section", section, count };
}

/**
 * Finds where the item dragged would land with the pointer at (x, y).
 * On a row, its top or bottom 30 % puts the item before or after, its
 * middle merges or puts it inside. Top-level rows of 进行中 and 已完成 have
 * no order of their own: their edges stand for the section. The bottom of
 * an open parent is the top of its first child. Elsewhere in a section, its
 * title included, the item takes the section's status.
 */
function dropAt(x: number, y: number, map: DropMap, active: Item, moving: ReadonlySet<number>): Drop | null {
  const hit = document.elementFromPoint(x, y);
  const el = hit?.closest<HTMLElement>("[data-queue-row]");
  if (!el) {
    const section = hit?.closest<HTMLElement>("[data-queue-section]")?.dataset.queueSection as ItemStatus | undefined;
    return section ? sectionDrop(active, section) : null;
  }
  const overId = Number(el.dataset.itemId);
  const info = map.rows.get(overId);
  if (!info || moving.has(overId)) return null;
  const { row } = info;
  const r = el.getBoundingClientRect();
  const at = (y - r.top) / r.height;
  const middle: Zone = row.hasChildren ? "inside" : "merge";
  const zone: Zone = at < 0.3 ? "before" : at > 0.7 ? "after" : middle;
  if (zone === "merge" || zone === "inside") return { kind: "row", overId, zone, status: null, count: 0 };
  if (row.depth === 0 && info.section !== "todo") return sectionDrop(active, info.section);
  if (zone === "after" && row.hasChildren && !row.collapsed && info.next && info.next.depth === row.depth + 1) {
    if (moving.has(info.next.item.id)) return null;
    return { kind: "row", overId: info.next.item.id, zone: "before", status: null, count: 0 };
  }
  // Among the top-level items to do, the item becomes one of them.
  const count = row.depth === 0 ? statusChanges(useAtlas.getState().items, active.id, "todo").length : 0;
  return { kind: "row", overId, zone, status: count ? "todo" : null, count };
}

/** The sections of the queue, top to bottom. */
const SECTIONS: ItemStatus[] = ["doing", "todo", "done"];

/** How many items of the trees match the filters. */
const countOf = (trees: TreeRows[]) => trees.reduce((n, t) => n + t.matched, 0);

/** Lets the mouse drag the rows of the queue onto each other and onto the sections. */
function QueueDnd({ trees, children }: { trees: TreeRows[][]; children: ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  // Built for every layout, read only while dragging.
  const map = useMemo<DropMap>(() => {
    const rows = new Map<number, RowInfo>();
    trees.forEach((list, i) => {
      for (const t of list) {
        t.rows.forEach((row, j) => rows.set(row.item.id, { row, section: SECTIONS[i]!, next: t.rows[j + 1] }));
      }
    });
    return { rows, firstTodo: trees[1]?.[0]?.root.id ?? 0 };
  }, [trees]);
  const current = useRef(map);
  useLayoutEffect(() => {
    current.current = map;
  }, [map]);

  const stop = useRef<() => void>(() => {});
  const active = useDrag((s) => s.active);
  const movingCount = useDrag((s) => s.moving.size);

  const onDragStart = ({ active: dragged, activatorEvent }: DragStartEvent) => {
    const id = Number(dragged.id);
    const { items } = useAtlas.getState();
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const moving = subtreeIds(buildForest(items), id);
    useDrag.setState({ active: item, moving, drop: null });
    document.documentElement.classList.add("dragging-rows");
    const pointer = { x: 0, y: 0 };
    if (activatorEvent instanceof PointerEvent || activatorEvent instanceof MouseEvent) {
      pointer.x = activatorEvent.clientX;
      pointer.y = activatorEvent.clientY;
    }
    const update = () => {
      const next = dropAt(pointer.x, pointer.y, current.current, item, moving);
      if (!sameDrop(useDrag.getState().drop, next)) useDrag.setState({ drop: next });
    };
    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      update();
    };
    // The queue scrolls by itself near its edges, and empty sections open
    // up as drop targets: what is under the pointer changes.
    window.addEventListener("pointermove", onMove);
    window.addEventListener("scroll", update, true);
    const frame = requestAnimationFrame(update);
    stop.current = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", update, true);
      document.documentElement.classList.remove("dragging-rows");
    };
  };

  const finish = (apply: boolean) => {
    stop.current();
    const { active: item, drop } = useDrag.getState();
    useDrag.setState({ active: null, moving: new Set(), drop: null });
    if (!apply || !drop || !item) return;
    const id = item.id;
    if (drop.kind === "section") {
      const { firstTodo } = current.current;
      const toTop = drop.section === "todo" && item.parentId === 0 && firstTodo !== 0 && firstTodo !== id;
      void dropItem(id, toTop ? { anchorId: firstTodo, place: "before" } : null, drop.count ? drop.section : null);
      flashRow(id);
    } else if (drop.zone === "merge") {
      void mergeItems(id, drop.overId).then((parent) => parent && flashRow(parent.id));
    } else {
      void dropItem(id, { anchorId: drop.overId, place: drop.zone }, drop.status);
      flashRow(id);
    }
  };

  useEffect(() => () => stop.current(), []);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={() => finish(true)} onDragCancel={() => finish(false)}>
      {children}
      <DragOverlay dropAnimation={null} className="pointer-events-none">
        {active && <DragPreview item={active} under={movingCount - 1} />}
      </DragOverlay>
    </DndContext>
  );
}

/** The row that follows the pointer while dragging. */
function DragPreview({ item, under }: { item: Item; under: number }) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-md bg-popover px-2 shadow-xl ring-1 ring-primary/40 animate-in fade-in-0 zoom-in-[0.98] duration-150">
      <TypeIcon type={item.type} />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {under > 0 && <span className="meta-mono shrink-0 rounded-sm bg-muted px-1.5 leading-5 text-muted-foreground">+{under}</span>}
    </div>
  );
}

// ---- The queue ----

export function Queue() {
  const items = useAtlas((s) => s.items);
  const modules = useAtlas((s) => s.modules);
  const typeFilter = useAtlas((s) => s.typeFilter);
  const moduleFilter = useAtlas((s) => s.moduleFilter);
  const statusFilter = useAtlas((s) => s.statusFilter);
  const collapsed = useAtlas((s) => s.collapsed);
  const sectionOpen = useAtlas((s) => s.sectionOpen);
  const selectedId = useAtlas((s) => s.selectedId);
  const flashId = useQueueUi((s) => s.flashId);
  const doneLimit = useQueueUi((s) => s.doneLimit);

  const { doing, todo, done } = useMemo(
    () => layoutQueue({ items, typeFilter, moduleFilter, statusFilter, collapsed }),
    [items, typeFilter, moduleFilter, statusFilter, collapsed],
  );
  const dndTrees = useMemo(() => {
    const shown = (section: ItemStatus) => sectionShown({ statusFilter, sectionOpen }, section);
    return [shown("doing") ? doing : [], shown("todo") ? todo : [], shown("done") ? done.slice(0, doneLimit) : []];
  }, [doing, todo, done, doneLimit, statusFilter, sectionOpen]);
  const moduleNames = useMemo(() => new Map(modules.map((m) => [m.id, m.name])), [modules]);
  // Rows keep room for the arrows that open and close children once any item has some.
  const nested = useMemo(() => items.some((i) => i.parentId !== 0), [items]);
  // The module shows on each row unless the queue shows one module only.
  const moduleOf = (item: Item) => (moduleFilter === "all" ? (moduleNames.get(item.moduleId) ?? "") : "");
  const rows = (trees: TreeRows[]) =>
    trees.flatMap((t) =>
      t.rows.map((r) => (
        <ItemRow
          key={r.item.id}
          item={r.item}
          depth={r.depth}
          hasChildren={r.hasChildren}
          collapsed={r.collapsed}
          done={r.done}
          total={r.total}
          context={r.context}
          nested={nested}
          moduleName={moduleOf(r.item)}
          selected={r.item.id === selectedId}
          flash={r.item.id === flashId}
        />
      )),
    );

  const filtered = typeFilter !== "all" || moduleFilter !== "all" || statusFilter !== "all";
  const nothing = doing.length + todo.length + done.length === 0;
  // With all statuses shown, each section opens and closes; filtered to one, it stays open.
  const collapsible = statusFilter === "all";
  const has = (section: ItemStatus) => statusFilter === "all" || statusFilter === section;

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
          <QueueDnd trees={dndTrees}>
            {has("doing") && (
              <QueueSection section="doing" count={countOf(doing)} collapsible={collapsible} empty={doing.length === 0}>
                {rows(doing)}
              </QueueSection>
            )}
            {has("todo") && (
              <QueueSection section="todo" count={countOf(todo)} collapsible={collapsible} empty={todo.length === 0}>
                {todo.length === 0 ? <p className="px-2 py-1.5 text-xs text-muted-foreground">没有待办了。</p> : rows(todo)}
              </QueueSection>
            )}
            {has("done") && (
              <QueueSection section="done" count={countOf(done)} collapsible={collapsible} empty={done.length === 0}>
                {rows(done.slice(0, doneLimit))}
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
              </QueueSection>
            )}
          </QueueDnd>
        )}
      </div>
      <NewItemInput />
    </div>
  );
}

/** Each section's title, and what dropping a row on it does. */
const SECTION_INFO: Record<ItemStatus, { title: string; icon?: typeof Play; iconClass?: string; drop: string; dropTop?: string }> = {
  doing: { title: "进行中", icon: CircleDot, iconClass: "text-doing", drop: "开始进行" },
  todo: { title: "待办", drop: "改为待办", dropTop: "移到待办最前" },
  done: { title: "已完成", icon: CircleCheck, iconClass: "text-done", drop: "标为完成" },
};

interface QueueSectionProps {
  section: ItemStatus;
  count: number;
  /** Whether its title opens and closes it. */
  collapsible: boolean;
  /** No tree is in it. An empty 已完成 shows only while a row is dragged, as a place to drop it. */
  empty: boolean;
  children: ReactNode;
}

/**
 * A section of the queue, its title on top. Dropping a row on any of it
 * that is not another row gives the row its status.
 */
function QueueSection({ section, count, collapsible, empty, children }: QueueSectionProps) {
  const info = SECTION_INFO[section];
  const open = useAtlas((s) => sectionShown(s, section));
  const dragging = useDrag((s) => s.active !== null);
  const target = useDrag((s) => s.drop?.kind === "section" && s.drop.section === section);
  const changes = useDrag((s) => (s.drop?.kind === "section" && s.drop.section === section ? s.drop.count : 0));
  const toTop = useDrag((s) => section === "todo" && s.active?.parentId === 0);
  if (empty && section === "done" && !dragging) return null;
  const Icon = info.icon;
  const title = (
    <>
      {collapsible && <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} />}
      {Icon && <Icon className={cn("size-3.5", info.iconClass)} />}
      {info.title}
      <span className="meta-mono">{count}</span>
    </>
  );
  const head = "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground";
  return (
    <section
      data-queue-section={section}
      className={cn(
        "relative mb-2 rounded-lg transition-[background-color,box-shadow] duration-150",
        target && "bg-primary/5 shadow-[inset_0_0_0_1.5px_var(--primary)]",
      )}
    >
      <h2 className="flex items-center">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setSectionOpen(section)}
            className={cn(head, "transition-colors hover:text-foreground")}
          >
            {title}
          </button>
        ) : (
          <span className={head}>{title}</span>
        )}
        {target && (
          <span className="ml-auto mr-2 flex h-5 items-center rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground shadow-md animate-in fade-in-0 zoom-in-90 duration-150">
            {changes === 0 && toTop && info.dropTop ? info.dropTop : info.drop}
            {changes > 1 && <span className="meta-mono ml-1 opacity-80">· {changes} 条</span>}
          </span>
        )}
      </h2>
      {open && !empty && <div className="flex flex-col">{children}</div>}
      {open && empty && section === "todo" && children}
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
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  /** How many items sit under it, and how many of them are done. */
  done: number;
  total: number;
  /** It does not match the filters: it shows, faded, above those under it that do. */
  context: boolean;
  /** Whether the project has sub-items: rows keep room for the arrow. */
  nested: boolean;
  /** The module's name to show, or "" to show none. */
  moduleName: string;
  selected: boolean;
  flash: boolean;
}

const ItemRow = memo(function ItemRow({
  item,
  depth,
  hasChildren,
  collapsed,
  done,
  total,
  context,
  nested,
  moduleName,
  selected,
  flash,
}: ItemRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected || flash) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected, flash]);
  const { setNodeRef, listeners } = useDraggable({ id: item.id });
  const zone = useDrag((s) => (s.drop?.kind === "row" && s.drop.overId === item.id ? s.drop.zone : null));
  const becomes = useDrag((s) => (s.drop?.kind === "row" && s.drop.overId === item.id ? s.drop.status : null));
  const becomesCount = useDrag((s) => (s.drop?.kind === "row" && s.drop.overId === item.id ? s.drop.count : 0));
  const moving = useDrag((s) => s.moving.has(item.id));
  const isDone = item.status === "done";
  // Where the content starts: the arrow's column of this level.
  const left = PAD + depth * INDENT;

  return (
    <ContextMenu onOpenChange={(open) => open && select(item.id)}>
      <ContextMenuTrigger asChild>
        <div
          ref={(el) => {
            ref.current = el;
            setNodeRef(el);
          }}
          {...listeners}
          data-queue-row=""
          data-item-id={item.id}
          aria-current={selected || undefined}
          onClick={() => select(item.id)}
          style={{ paddingLeft: left }}
          className={cn(
            "signal-row group relative flex h-9 items-center gap-2 rounded-md pr-2 transition-[background-color,opacity,box-shadow] duration-100",
            selected ? "bg-accent" : "hover:bg-accent/50",
            flash && "row-flash",
            moving && "opacity-35",
            (zone === "merge" || zone === "inside") && "bg-primary/10 shadow-[inset_0_0_0_1.5px_var(--primary)] hover:bg-primary/10",
          )}
        >
          {Array.from({ length: depth }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-px bg-border"
              style={{ left: PAD + i * INDENT + 7.5 }}
            />
          ))}
          {nested &&
            (hasChildren ? (
              <button
                type="button"
                aria-label={collapsed ? "展开子改进点" : "收起子改进点"}
                aria-expanded={!collapsed}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapsed(item.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <ChevronRight className={cn("size-3.5 transition-transform duration-150", !collapsed && "rotate-90")} />
              </button>
            ) : (
              <span aria-hidden className="w-4 shrink-0" />
            ))}
          <div className={cn("flex min-w-0 flex-1 items-center gap-2", context && "opacity-50")}>
            <StatusButton item={item} onToggle={() => toggleItemDone(item)} />
            <TypeIcon type={item.type} />
            <span className={cn("min-w-0 flex-1 truncate", isDone && "text-muted-foreground")}>{item.title}</span>
            {hasChildren && <TreeProgress done={done} total={total} />}
            {moduleName && (
              <span className="max-w-32 shrink-0 truncate rounded-sm bg-muted px-1.5 text-xs leading-5 text-muted-foreground">
                {moduleName}
              </span>
            )}
            {item.note.trim() && <FileText aria-label="有备注" className="size-3.5 shrink-0 text-muted-foreground" />}
            {item.deeplink && <LinkMark item={item} />}
            <RowTime item={item} />
            {!isDone && <RowActions item={item} shown={selected} />}
          </div>
          {zone && <DropMark zone={zone} status={becomes} count={becomesCount} left={left + (nested ? 24 : 0)} />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ItemMenuItems item={item} />
      </ContextMenuContent>
    </ContextMenu>
  );
});

/**
 * Where the row dragged would land: a line before or after this row, with
 * the status it takes there when that changes, or a badge on it.
 */
function DropMark({ zone, status, count, left }: { zone: Zone; status: ItemStatus | null; count: number; left: number }) {
  if (zone === "before" || zone === "after") {
    return (
      <span
        aria-hidden
        className={cn("pointer-events-none absolute right-2 z-10 h-0.5 rounded-full bg-primary", zone === "before" ? "-top-px" : "-bottom-px")}
        style={{ left }}
      >
        <span className="absolute top-1/2 -left-1 size-2 -translate-y-1/2 rounded-full border-2 border-primary bg-background" />
        {status && (
          <span className="absolute top-1/2 right-0 flex h-4 -translate-y-1/2 items-center rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground shadow-md animate-in fade-in-0 zoom-in-90 duration-150">
            {SECTION_INFO[status].drop}
            {count > 1 && <span className="meta-mono ml-1 opacity-80">· {count} 条</span>}
          </span>
        )}
      </span>
    );
  }
  const Icon = zone === "merge" ? Combine : CornerDownRight;
  return (
    <span className="pointer-events-none absolute top-1/2 right-2 z-10 flex h-5 -translate-y-1/2 items-center gap-1 rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground shadow-md animate-in fade-in-0 zoom-in-90 duration-150">
      <Icon className="size-3" />
      {zone === "merge" ? "合并" : "放入"}
    </span>
  );
}

/** How much of what is under a parent is done: a small ring and the counts. */
function TreeProgress({ done, total }: { done: number; total: number }) {
  const r = 5;
  const c = 2 * Math.PI * r;
  const all = total > 0 && done === total;
  return (
    <span
      className={cn("flex shrink-0 items-center gap-1 text-muted-foreground", all && "text-done")}
      aria-label={`子改进点完成 ${done} / ${total}`}
    >
      <svg viewBox="0 0 14 14" className="size-3.5 -rotate-90" aria-hidden>
        <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth="2" />
        <circle
          cx="7"
          cy="7"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - (total ? done / total : 0))}
          className="text-done transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      <span className="meta-mono">
        {done}/{total}
      </span>
    </span>
  );
}

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
      <ContextMenuItem onSelect={() => focusNewChild(item.id)}>
        <CornerDownRight />
        添加子改进点
      </ContextMenuItem>
      {item.parentId !== 0 && (
        <ContextMenuItem onSelect={() => moveItem(item.id, item.parentId, "after")}>
          <CornerLeftUp />
          移到上一级
        </ContextMenuItem>
      )}
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
        // A new item goes to 待办: show it there even if the user closed it.
        setSectionOpen("todo", true);
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
