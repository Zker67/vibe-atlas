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
  X,
} from "lucide-react";
import type { Item, ItemStatus, ItemType } from "@/mygo";
import { cn } from "@/lib/utils";
import { isComposing } from "@/lib/keys";
import { nextType, statusInfo, UNSORTED } from "@/lib/labels";
import { elapsed, formatTime, useNow } from "@/lib/time";
import { errorMessage, run } from "@/lib/api";
import { buildForest, linkSource, subtreeIds, type Row, type TreeRows } from "@/lib/tree";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Scroller } from "@/components/ui/scroller";
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
  newChildTaken,
  openDeeplink,
  reopenItem,
  reopenStatus,
  select,
  setCollapsed,
  setItemModule,
  setItemStatus,
  setItemTitle,
  setSectionOpen,
  sharesLinks,
  statusChanges,
  toggleCollapsed,
  toggleItemDoing,
  toggleItemDone,
  useAtlas,
  useLinkSource,
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

/** The item whose row is asked to turn its title into a field. */
const useRenameAsk = create<{ id: number }>(() => ({ id: 0 }));

/**
 * Enter: renames the item in its row, as a double click does. False when
 * the queue does not show it, for the caller to edit it elsewhere.
 */
export function renameInQueue(id: number): boolean {
  if (useAtlas.getState().view !== "queue" || !visibleRows().some((r) => r.item.id === id)) return false;
  useRenameAsk.setState({ id });
  return true;
}

/**
 * Tab: puts the item under the item of its level shown right above it, as
 * its last child. Nothing when none is: the first of its level stays.
 */
export function indentItem(id: number) {
  for (const trees of shownTrees(useAtlas.getState(), useQueueUi.getState().doneLimit)) {
    const rows = trees.flatMap((t) => t.rows);
    const at = rows.findIndex((r) => r.item.id === id);
    if (at < 0) continue;
    const depth = rows[at]!.depth;
    for (let j = at - 1; j >= 0 && rows[j]!.depth >= depth; j--) {
      if (rows[j]!.depth === depth) {
        moveItem(id, rows[j]!.item.id, "inside");
        return;
      }
    }
    return;
  }
}

/** Shift+Tab: takes the item a level up, right after its parent, as 「移到上一级」 does. */
export function outdentItem(id: number) {
  const item = useAtlas.getState().items.find((i) => i.id === id);
  if (item?.parentId) moveItem(id, item.parentId, "after");
}

/** The item a new one of its level is being named under, from Shift+Enter in a title. */
const useDraftAfter = create<{ id: number }>(() => ({ id: 0 }));

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
 * merged with it under a new parent; inside it, when it already has
 * children; or under it as its last child, from its bottom edge with the
 * pointer pushed to the right.
 */
type Zone = "before" | "after" | "merge" | "inside" | "child";

/**
 * Where a drag would land: on a row, with the status it takes there when
 * that changes; on a section, whose status it takes; or on a module of the
 * sidebar, 0 for 未分类, which it goes to.
 */
type Drop =
  | { kind: "row"; overId: number; zone: Zone; status: ItemStatus | null; count: number }
  | { kind: "section"; section: ItemStatus; count: number }
  | { kind: "module"; moduleId: number; count: number };

function sameDrop(a: Drop | null, b: Drop | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "module") return b.kind === "module" && a.moduleId === b.moduleId && a.count === b.count;
  if (a.kind === "section") return b.kind === "section" && a.section === b.section && a.count === b.count;
  if (b.kind !== "row") return false;
  return a.overId === b.overId && a.zone === b.zone && a.status === b.status && a.count === b.count;
}

/** The drag under way: the item dragged, it and what is under it, where it would land. */
const useDrag = create<{ active: Item | null; moving: ReadonlySet<number>; drop: Drop | null }>(() => ({
  active: null,
  moving: new Set(),
  drop: null,
}));

/**
 * How many items a row of the queue dragged onto the module of the sidebar,
 * 0 for 未分类, would move there; 0 while it is not.
 */
export function useModuleDropOver(moduleId: number): number {
  return useDrag((s) => (s.drop?.kind === "module" && s.drop.moduleId === moduleId ? s.drop.count : 0));
}

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
 * Finds where the item dragged would land with the pointer at (x, y), dx
 * to the right of where the drag started. On a row, its top or bottom EDGE
 * puts the item before or after, its middle merges or puts it inside. The
 * bottom with the pointer a level to the right puts the item under the row.
 * Top-level rows of 已完成 have no order of their own: their edges stand
 * for the section. The bottom of an open parent is the top of
 * its first child. Elsewhere in a section, its title included, the item
 * takes the section's status. On a module of the sidebar, other than its
 * own and its children's, the item goes to that module with them.
 */
/**
 * How much of a row, from its top and from its bottom, puts the item before
 * or after it; the middle left, a third or less, merges. Moving is what a
 * drag mostly does: it gets the larger share.
 */
const EDGE = 0.35;

function dropAt(x: number, y: number, dx: number, map: DropMap, active: Item, moving: ReadonlySet<number>): Drop | null {
  const hit = document.elementFromPoint(x, y);
  const target = hit?.closest<HTMLElement>("[data-module-drop]");
  if (target) {
    const moduleId = Number(target.dataset.moduleDrop);
    const count = moduleChanges(moving, moduleId).length;
    return count ? { kind: "module", moduleId, count } : null;
  }
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
  const zone: Zone = at < EDGE ? "before" : at > 1 - EDGE ? "after" : middle;
  if (zone === "merge" || zone === "inside") return { kind: "row", overId, zone, status: null, count: 0 };
  const first = zone === "after" && row.hasChildren && !row.collapsed && info.next?.depth === row.depth + 1 ? info.next : undefined;
  const under = zone === "after" && dx >= INDENT;
  if (under && !first) return { kind: "row", overId, zone: "child", status: null, count: 0 };
  if (row.depth === 0 && info.section === "done" && !under) return sectionDrop(active, info.section);
  if (first) {
    if (moving.has(first.item.id)) return null;
    return { kind: "row", overId: first.item.id, zone: "before", status: null, count: 0 };
  }
  // Among the top-level items doing or to do, the item becomes one of them.
  const count = row.depth === 0 ? statusChanges(useAtlas.getState().items, active.id, info.section).length : 0;
  return { kind: "row", overId, zone, status: count ? info.section : null, count };
}

/** The ids of the items dragged, it and those under it, not in the module yet. */
function moduleChanges(moving: ReadonlySet<number>, moduleId: number): number[] {
  return useAtlas
    .getState()
    .items.filter((i) => moving.has(i.id) && i.moduleId !== moduleId)
    .map((i) => i.id);
}

/**
 * A row dropped on a module of the sidebar: the item and every item under
 * it go to the module. When the queue shows another module only, the rows
 * leave it: a toast says where they went.
 */
async function dropOnModule(item: Item, moving: ReadonlySet<number>, moduleId: number) {
  for (const id of moduleChanges(moving, moduleId)) {
    if (!(await setItemModule(id, moduleId))) return;
  }
  const { moduleFilter, modules } = useAtlas.getState();
  if (moduleFilter !== "all" && moduleFilter !== moduleId) {
    const name = moduleId ? (modules.find((m) => m.id === moduleId)?.name ?? "") : UNSORTED;
    const under = moving.size - 1;
    toast.success(under > 0 ? `已移到「${name}」，子改进点 ${under} 条一起` : `已移到「${name}」`);
  } else {
    flashRow(item.id);
  }
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
    const startX = pointer.x;
    const update = () => {
      const next = dropAt(pointer.x, pointer.y, pointer.x - startX, current.current, item, moving);
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
    const { active: item, moving, drop } = useDrag.getState();
    useDrag.setState({ active: null, moving: new Set(), drop: null });
    if (!apply || !drop || !item) return;
    const id = item.id;
    if (drop.kind === "module") {
      void dropOnModule(item, moving, drop.moduleId);
    } else if (drop.kind === "section") {
      const { firstTodo } = current.current;
      const toTop = drop.section === "todo" && item.parentId === 0 && firstTodo !== 0 && firstTodo !== id;
      void dropItem(id, toTop ? { anchorId: firstTodo, place: "before" } : null, drop.count ? drop.section : null);
      flashRow(id);
    } else if (drop.zone === "merge") {
      void mergeItems(id, drop.overId).then((parent) => parent && flashRow(parent.id));
    } else {
      void dropItem(id, { anchorId: drop.overId, place: drop.zone === "child" ? "inside" : drop.zone }, drop.status);
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

/**
 * The row that follows the pointer while dragging. With items under it, the
 * cards of a stack peek out below it. Where letting go changes nothing, it
 * fades and loses its accent.
 */
function DragPreview({ item, under }: { item: Item; under: number }) {
  const landing = useDrag((s) => s.drop !== null);
  const layer = "absolute inset-x-0 h-full rounded-md bg-popover ring-1 ring-foreground/10 shadow-md";
  return (
    <div
      className={cn(
        "relative animate-in fade-in-0 zoom-in-95 duration-200 ease-out transition-opacity",
        !landing && "opacity-75",
      )}
    >
      {under > 1 && <div aria-hidden className={cn(layer, "top-2 scale-x-[0.92] opacity-50")} />}
      {under > 0 && <div aria-hidden className={cn(layer, "top-1 scale-x-[0.96] opacity-80")} />}
      <div
        className={cn(
          "relative flex h-9 items-center gap-2 rounded-md bg-popover px-2 shadow-xl ring-1 transition-[box-shadow] duration-150",
          landing ? "ring-primary/50" : "ring-foreground/10",
        )}
      >
        <TypeIcon type={item.type} />
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
        {under > 0 && <span className="meta-mono shrink-0 rounded-sm bg-muted px-1.5 leading-5 text-muted-foreground">+{under}</span>}
      </div>
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
  const draftAfter = useDraftAfter((s) => s.id);
  const shared = useAtlas(sharesLinks);

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
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const rows = (trees: TreeRows[]) =>
    trees.flatMap((t) => {
      const out = t.rows.map((r) => {
        const source = linkSource(byId, r.item.id, shared);
        return (
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
            link={source?.deeplink ?? ""}
            linkFrom={source && source.id !== r.item.id ? source.title : ""}
            selected={r.item.id === selectedId}
            flash={r.item.id === flashId}
          />
        );
      });
      // The new item being named goes under the one it follows, after what shows under that.
      const at = draftAfter ? t.rows.findIndex((r) => r.item.id === draftAfter) : -1;
      if (at >= 0) {
        const after = t.rows[at]!;
        let end = at + 1;
        while (end < t.rows.length && t.rows[end]!.depth > after.depth) end++;
        out.splice(end, 0, <DraftRow key={`draft-${after.item.id}`} after={after.item} depth={after.depth} nested={nested} />);
      }
      return out;
    });

  const filtered = typeFilter !== "all" || moduleFilter !== "all" || statusFilter !== "all";
  const nothing = doing.length + todo.length + done.length === 0;
  // With all statuses shown, each section opens and closes; filtered to one, it stays open.
  const collapsible = statusFilter === "all";
  const has = (section: ItemStatus) => statusFilter === "all" || statusFilter === section;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Scroller
        className="flex-1"
        viewportClassName="px-3 pt-2 pb-4"
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
      </Scroller>
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
  const name = useAtlas((s) => s.projects.find((p) => p.id === s.projectId)?.name ?? "");
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
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
      <Inbox className="mb-1 size-8 opacity-50" />
      <p className="max-w-full break-words text-base font-medium text-foreground">「{name}」的故事，从第一条开始</p>
      <p>在下方写下第一条</p>
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
  /** The link it opens, or "" for none; linkFrom is the title of the item above it the link comes from, or "". */
  link: string;
  linkFrom: string;
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
  link,
  linkFrom,
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
  // The row picked up, not those under it: where it was shows as an outline.
  const picked = useDrag((s) => s.active?.id === item.id);
  const isDone = item.status === "done";
  // Renamed after a double click, or after Enter asked for it.
  const [renamingHere, setRenaming] = useState(false);
  const renameAsked = useRenameAsk((s) => s.id === item.id);
  const renaming = renamingHere || renameAsked;
  const stopRenaming = () => {
    setRenaming(false);
    if (useRenameAsk.getState().id === item.id) useRenameAsk.setState({ id: 0 });
  };
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
          onDoubleClick={(e) => {
            // The circle, the arrow and the row's buttons keep their own clicks.
            if ((e.target as HTMLElement).closest("button, a, input")) return;
            setRenaming(true);
          }}
          style={{ paddingLeft: left }}
          className={cn(
            "signal-row group relative flex h-9 items-center gap-2 rounded-md pr-2 transition-[background-color,opacity,box-shadow] duration-100",
            selected ? "bg-accent" : "hover:bg-accent/50",
            flash && "row-flash",
            moving && "opacity-40",
            picked && "bg-muted/40 outline-1 -outline-offset-1 outline-primary/40 outline-dashed",
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
            {renaming ? (
              <RowTitleInput item={item} onDone={stopRenaming} />
            ) : (
              <span className={cn("min-w-0 flex-1 truncate", isDone && "text-muted-foreground")}>{item.title}</span>
            )}
            {hasChildren && <TreeProgress done={done} total={total} />}
            {moduleName && (
              <span className="max-w-32 shrink-0 truncate rounded-sm bg-muted px-1.5 text-xs leading-5 text-muted-foreground">
                {moduleName}
              </span>
            )}
            {item.note.trim() && <FileText aria-label="有备注" className="size-3.5 shrink-0 text-muted-foreground" />}
            {link && <LinkMark item={item} link={link} from={linkFrom} />}
            <RowTime item={item} />
            {!isDone && <RowActions item={item} shown={selected} />}
          </div>
          {zone && <DropMark zone={zone} status={becomes} count={becomesCount} left={left + (nested ? 24 : 0)} />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-52"
        // 「添加子改进点」 moves the keyboard to the field under the queue: keep it there.
        onCloseAutoFocus={(e) => {
          if (useAtlas.getState().newChildFor) e.preventDefault();
        }}
      >
        <ItemMenuItems item={item} />
      </ContextMenuContent>
    </ContextMenu>
  );
});

/**
 * Where the row dragged would land: a line before or after this row, with
 * the status it takes there when that changes; a line a level in under it,
 * for a child; or a badge on it.
 */
function DropMark({ zone, status, count, left }: { zone: Zone; status: ItemStatus | null; count: number; left: number }) {
  if (zone === "before" || zone === "after" || zone === "child") {
    const child = zone === "child";
    return (
      <span
        aria-hidden
        className={cn(
          "drop-line pointer-events-none absolute right-2 z-10 h-0.5 rounded-full bg-primary transition-[left] duration-150 ease-out",
          zone === "before" ? "-top-px" : "-bottom-px",
        )}
        style={{ left: child ? left + INDENT : left }}
      >
        <span className="absolute top-1/2 -left-1 size-2 -translate-y-1/2 rounded-full border-2 border-primary bg-background" />
        {(status || child) && (
          <span className="absolute top-1/2 right-0 flex h-4 -translate-y-1/2 items-center gap-1 rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground shadow-md animate-in fade-in-0 zoom-in-90 duration-150">
            {child && <CornerDownRight className="size-3" />}
            {child ? "成为子改进点" : status && SECTION_INFO[status].drop}
            {!child && count > 1 && <span className="meta-mono ml-1 opacity-80">· {count} 条</span>}
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

/** The link the row opens; one that comes from an item above shows fainter, and says so. */
function LinkMark({ item, link, from }: { item: Item; link: string; from: string }) {
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
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground",
            from && "opacity-60",
          )}
        >
          <Link2 className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 break-all">
        {from && <span className="block opacity-70">沿用「{from}」的链接</span>}
        {link}
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

/** The row's buttons: to do starts or finishes, doing only finishes; both copy. */
function RowActions({ item, shown }: { item: Item; shown: boolean }) {
  const todo = item.status === "todo";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100",
        shown && "opacity-100",
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {todo && (
        <IconButton
          label="开始进行"
          shortcut="S"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            toggleItemDoing(item);
          }}
        >
          <Play />
        </IconButton>
      )}
      <IconButton
        label="标为完成"
        shortcut="Space"
        size="icon-xs"
        onClick={(e) => {
          e.stopPropagation();
          toggleItemDone(item);
        }}
      >
        <CircleCheck />
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
  /** It takes a done item back to the status it had before. */
  reopen?: boolean;
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
      return reopenStatus(item) === "doing"
        ? [
            { label: "重新打开，回到进行中", status: "doing", icon: RotateCcw, shortcut: "Space", reopen: true },
            { label: "改为待办", status: "todo", icon: Pause, shortcut: "" },
          ]
        : [
            { label: "重新打开", status: "todo", icon: RotateCcw, shortcut: "Space", reopen: true },
            { label: "重新开始进行", status: "doing", icon: Play, shortcut: "" },
          ];
  }
}

/** What the right-click menu of a row offers. It mounts only while the menu is open. */
function ItemMenuItems({ item }: { item: Item }) {
  const projects = useAtlas((s) => s.projects);
  const modules = useAtlas((s) => s.modules);
  const others = projects.filter((p) => p.id !== item.projectId);
  const linked = useLinkSource(item.id) !== null;
  return (
    <>
      {statusActions(item).map((a) => (
        <ContextMenuItem key={a.status} onSelect={() => void (a.reopen ? reopenItem(item.id) : setItemStatus(item.id, a.status))}>
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
      {linked && (
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

/**
 * The title, renamed in its row after a double click or Enter: Enter or
 * leaving saves, Escape gives it up, Shift+Enter saves and names a new item
 * of its level under it.
 */
function RowTitleInput({ item, onDone }: { item: Item; onDone(): void }) {
  const [draft, setDraft] = useState(item.title);
  const field = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const next = useRef(false);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const finish = () => {
    const text = draft.trim();
    if (!cancelled.current && text && text !== item.title) void setItemTitle(item.id, text);
    onDone();
    if (next.current) useDraftAfter.setState({ id: item.id });
  };

  return (
    <input
      ref={field}
      value={draft}
      maxLength={300}
      aria-label="标题"
      spellCheck={false}
      className="-mx-1 h-7 min-w-0 flex-1 rounded-sm bg-background px-1 ring-1 ring-ring/50 outline-none"
      onChange={(e) => setDraft(e.target.value)}
      // Selecting text in the field must not drag the row.
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={finish}
      onKeyDown={(e) => {
        if (isComposing(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          next.current = e.shiftKey;
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * A new item of after's level, being named in the row under it: under the
 * same parent, of the same kind and module, to do. It is added once it has
 * a title, on Enter or when the field is left; Shift+Enter adds it and
 * names one more under it. Empty, Escape or leaving gives it up.
 */
function DraftRow({ after, depth, nested }: { after: Item; depth: number; nested: boolean }) {
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLInputElement>(null);
  // Once it is being added, leaving the field must not add it twice.
  const busy = useRef(false);
  const Todo = statusInfo("todo").icon;
  useEffect(() => {
    field.current?.focus();
  }, []);

  const close = () => {
    if (useDraftAfter.getState().id === after.id) useDraftAfter.setState({ id: 0 });
  };
  const add = async (more: boolean) => {
    const title = draft.trim();
    if (busy.current) return;
    if (!title) {
      if (!more) close();
      return;
    }
    busy.current = true;
    const item = await run(createItem(title, after.type, after.moduleId, after.parentId));
    if (!item) {
      busy.current = false;
      field.current?.focus();
      return;
    }
    moveItem(item.id, after.id, "after");
    select(item.id);
    if (more) useDraftAfter.setState({ id: item.id });
    else close();
  };

  return (
    <div
      data-queue-draft=""
      style={{ paddingLeft: PAD + depth * INDENT }}
      className="relative flex h-9 items-center gap-2 rounded-md bg-accent/50 pr-2"
    >
      {Array.from({ length: depth }, (_, i) => (
        <span key={i} aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-border" style={{ left: PAD + i * INDENT + 7.5 }} />
      ))}
      {nested && <span aria-hidden className="w-4 shrink-0" />}
      <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center", statusInfo("todo").text)}>
        <Todo className="size-4" />
      </span>
      <TypeIcon type={after.type} />
      <input
        ref={field}
        value={draft}
        maxLength={300}
        aria-label="新改进点的标题"
        placeholder="新改进点的标题，Enter 保存，Shift+Enter 再加一条"
        spellCheck={false}
        className="-mx-1 h-7 min-w-0 flex-1 rounded-sm bg-background px-1 ring-1 ring-ring/50 outline-none placeholder:text-muted-foreground"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void add(false)}
        onKeyDown={(e) => {
          if (isComposing(e)) return;
          if (e.key === "Enter") {
            e.preventDefault();
            void add(e.shiftKey);
          } else if (e.key === "Escape") {
            e.preventDefault();
            busy.current = true;
            close();
          }
        }}
      />
    </div>
  );
}

// ---- Adding ----

/**
 * The field under the queue: a title and Enter add an item to do. After
 * 「添加子改进点」 in an item's menu, it adds children to that item, in its
 * module, until Escape or the × on the mark of the parent.
 */
function NewItemInput() {
  const typeFilter = useAtlas((s) => s.typeFilter);
  const moduleFilter = useAtlas((s) => s.moduleFilter);
  const modules = useAtlas((s) => s.modules);
  const focusSignal = useAtlas((s) => s.focusNewItem);
  const parentId = useAtlas((s) => s.newChildFor);
  const parent = useAtlas((s) => (s.newChildFor ? s.items.find((i) => i.id === s.newChildFor) : undefined));
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

  // Children start in their parent's kind.
  const [seenParent, setSeenParent] = useState(0);
  if (parentId !== seenParent) {
    setSeenParent(parentId);
    if (parent) setType(parent.type);
  }
  useEffect(() => {
    if (parentId) input.current?.focus();
  }, [parentId]);
  // The parent was deleted or moved to another project meanwhile.
  useEffect(() => {
    if (parentId && !parent) newChildTaken();
  }, [parentId, parent]);

  const moduleId = typeof moduleFilter === "number" ? moduleFilter : 0;
  const moduleName = moduleFilter === "all" ? "" : moduleFilter === 0 ? UNSORTED : (modules.find((m) => m.id === moduleFilter)?.name ?? "");

  // The field clears at once, so the next title can follow without waiting;
  // a title that failed to save comes back unless another was typed since.
  const submit = async () => {
    const text = title.trim();
    if (!text) return;
    setTitle("");
    try {
      const item = await createItem(text, type, parent ? parent.moduleId : moduleId, parent?.id);
      setError("");
      const s = useAtlas.getState();
      if (matchesFilters(item, s.typeFilter, s.moduleFilter) && matchesStatus(item, s.statusFilter)) {
        // A new child shows under its parent, opened; a new top-level item
        // goes to 待办: show it there even if the user closed it.
        if (parent) setCollapsed(parent.id, false);
        else setSectionOpen("todo", true);
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
        {parent && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex h-6 max-w-36 shrink-0 items-center gap-1 rounded-md bg-muted pr-0.5 pl-1.5 text-xs text-muted-foreground">
                <CornerDownRight className="size-3 shrink-0" />
                <span className="truncate">{parent.title}</span>
                <button
                  type="button"
                  aria-label="不再添加子改进点"
                  className="grid size-4 shrink-0 place-items-center rounded-sm transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => {
                    newChildTaken();
                    input.current?.focus();
                  }}
                >
                  <X className="size-3" />
                </button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              添加为「{parent.title}」的子改进点<span className="ml-1.5 opacity-60">Esc 取消</span>
            </TooltipContent>
          </Tooltip>
        )}
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
          placeholder={parent ? "子改进点的标题，按 Enter 添加" : "记一条改进点，按 Enter 保存"}
          aria-label={parent ? "新子改进点的标题" : "新改进点的标题"}
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
              if (parent) newChildTaken();
              else input.current?.blur();
            }
          }}
        />
        {moduleName && !parent && (
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
