import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
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
  Flame,
  Inbox,
  Link2,
  ListChecks,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import type { Item, ItemStatus, ItemType } from "@/mygo";
import { useFlip } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { isComposing } from "@/lib/keys";
import { nextType, statusInfo, UNSORTED } from "@/lib/labels";
import { elapsed, formatTime, useNow } from "@/lib/time";
import { errorMessage, run } from "@/lib/api";
import { ancestors, applyMove, buildForest, linkSource, subtreeIds, topMost, type Row, type TreeRows } from "@/lib/tree";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Scroller } from "@/components/ui/scroller";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
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
  copyItems,
  createItem,
  deleteItem,
  deleteItems,
  dropItems,
  focusNewChild,
  inQueueOrder,
  layoutQueue,
  matchesFilters,
  matchesStatus,
  mergeItems,
  moveItem,
  moveItemToProject,
  moveItemsToProject,
  newChildTaken,
  openDeeplink,
  reopenItem,
  reopenItems,
  reopenStatus,
  select,
  setCollapsed,
  setItemModule,
  setItemsModule,
  setItemStatus,
  setItemsStatus,
  setItemTitle,
  setSectionOpen,
  setSelection,
  sharesLinks,
  statusChanges,
  toggleCollapsed,
  toggleItemDoing,
  toggleItemDone,
  toggleSelected,
  trashItems,
  useAtlas,
  useLinkSource,
  type Drop as ItemDrop,
} from "@/state/atlas";
import { PURGE_KEY, purgeKeyDown, usePurgeKey } from "@/lib/purge-key";
import { askConfirm } from "@/state/dialogs";
import { sessionLabel, useSessionLook } from "@/state/sessions";
import { AgentIcon } from "./agent-icon";
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
 * The item of id's level shown right above it, in the queue as s lays it
 * out; 0 when none is: the first of its level.
 */
function indentTarget(s: QueueLayoutState, id: number): number {
  for (const trees of shownTrees(s, useQueueUi.getState().doneLimit)) {
    const rows = trees.flatMap((t) => t.rows);
    const at = rows.findIndex((r) => r.item.id === id);
    if (at < 0) continue;
    const depth = rows[at]!.depth;
    for (let j = at - 1; j >= 0 && rows[j]!.depth >= depth; j--) {
      if (rows[j]!.depth === depth) return rows[j]!.item.id;
    }
    return 0;
  }
  return 0;
}

/**
 * Tab: puts each of the items under the item of its level shown right
 * above it, as its last child, top to bottom, each where those before it
 * left the queue. Nothing for the first of its level. One under another
 * of them that went in goes along with it; under one that could not, it
 * goes in on its own.
 */
export function indentItems(ids: number[]) {
  const s = useAtlas.getState();
  let items = s.items;
  const moved = new Set<number>();
  const drops: ItemDrop[] = [];
  for (const id of inQueueOrder(items, ids)) {
    if (ancestors(buildForest(items), id).some((a) => moved.has(a.id))) continue;
    const target = indentTarget({ ...s, items }, id);
    if (!target) continue;
    drops.push({ id, move: { anchorId: target, place: "inside" }, status: null });
    moved.add(id);
    items = applyMove(items, id, target, "inside") ?? items;
  }
  void dropItems(drops);
}

/**
 * Shift+Tab: takes each of the items a level up, right after its parent,
 * as 「移到上一级」 does; their order stays. One under another of them that
 * goes up goes along with it; under a top-level one, it goes up on its own.
 */
export function outdentItems(ids: number[]) {
  const { items } = useAtlas.getState();
  const forest = buildForest(items);
  const parentOf = new Map(items.map((i) => [i.id, i.parentId]));
  const ordered = inQueueOrder(items, ids);
  const up = new Set(ordered.filter((id) => parentOf.get(id)));
  const list = ordered.filter((id) => up.has(id) && !ancestors(forest, id).some((a) => up.has(a.id)));
  // The last first: each goes right after its parent, before those already there.
  list.reverse();
  void dropItems(list.map((id) => ({ id, move: { anchorId: parentOf.get(id)!, place: "after" }, status: null })));
}

// ---- Selecting ----

const visibleIds = () => visibleRows().map((r) => r.item.id);

/**
 * Shift+click, Shift+↑↓: selects the rows shown from the anchor, the row
 * Shift goes on from, to id; with add, on top of what is selected. Without
 * an anchor in sight, from the row the keys act from.
 */
export function selectRange(id: number, add = false) {
  const s = useAtlas.getState();
  const ids = visibleIds();
  const to = ids.indexOf(id);
  if (to < 0) return;
  let from = ids.indexOf(s.selectAnchor);
  if (from < 0) from = ids.indexOf(s.selectedId);
  if (from < 0) {
    select(id);
    return;
  }
  const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
  setSelection(add ? [...s.selectedIds, ...range] : range, id, ids[from]);
}

/** Shift+↑↓: moves the row the keys act from, the selection stretching from the anchor to it. */
export function extendSelection(delta: number) {
  const ids = visibleIds();
  if (ids.length === 0) return;
  const at = ids.indexOf(useAtlas.getState().selectedId);
  if (at < 0) select(ids[delta > 0 ? 0 : ids.length - 1]!);
  else selectRange(ids[Math.min(ids.length - 1, Math.max(0, at + delta))]!);
}

/** Ctrl+A: selects every row the queue shows. */
export function selectAllRows() {
  const ids = visibleIds();
  if (ids.length === 0) return;
  const { selectedId } = useAtlas.getState();
  setSelection(ids, ids.includes(selectedId) ? selectedId : ids[0]!, ids[0]);
}

/** When the last drag of rows ended: the click that may follow it on the row picked up is no click. */
let draggedAt = 0;

/** A click on a row: selects it alone; with Ctrl / ⌘ adds it or takes it out; with Shift, the rows from the anchor. */
function clickRow(id: number, e: ReactMouseEvent) {
  if (performance.now() - draggedAt < 300) return;
  const toggle = e.ctrlKey || e.metaKey;
  if (e.shiftKey) selectRange(id, toggle);
  else if (toggle) toggleSelected(id);
  else select(id);
}

/** Right-click: a row of the selection keeps it and becomes the one the keys act from; another row is selected alone. */
function selectForMenu(id: number) {
  const s = useAtlas.getState();
  if (s.selectedIds.size > 1 && s.selectedIds.has(id)) setSelection(s.selectedIds, id);
  else select(id);
}

/**
 * The item a new one of its level is being named under, from Shift+Enter in
 * a title. text is what the new one starts with: the end of the title, cut
 * off where the caret was; restore is the whole title, put back on the item
 * when the new one is given up.
 */
const useDraftAfter = create<{ id: number; text: string; restore: string }>(() => ({ id: 0, text: "", restore: "" }));

/** What the row naming a new item starts with. */
function draftStart() {
  return useDraftAfter.getState();
}

/**
 * A title cut where the caret is, for Shift+Enter: what stays and what goes
 * to the new item. Nothing goes while text is selected, or when the caret
 * is not inside the words.
 */
function splitAtCaret(field: HTMLInputElement, text: string): { head: string; tail: string } {
  const at = field.selectionStart ?? text.length;
  const head = text.slice(0, at).trim();
  const tail = text.slice(at).trim();
  if (at !== field.selectionEnd || !head || !tail) return { head: text, tail: "" };
  return { head, tail };
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

/**
 * Delete: the item goes to the trash at once, a toast offering to undo. With
 * purge (Shift held), it is deleted for good, after asking.
 */
export function confirmDeleteItem(item: Item, purge = false) {
  if (!purge) {
    void trashItems([item.id]);
    return;
  }
  const children = buildForest(useAtlas.getState().items).byId.get(item.id)?.children.length ?? 0;
  askConfirm({
    title: `彻底删除「${item.title}」？`,
    description: children
      ? `不进回收站，删除后无法恢复。它的 ${children} 个子改进点会上移一层，不会被删除。`
      : "不进回收站，删除后无法恢复。",
    confirmText: "彻底删除",
    destructive: true,
    onConfirm: () => deleteItem(item.id),
  });
}

/** Delete on several: all go to the trash at once; with purge, asks once, saying how many go and how many children move up. */
export function confirmDeleteItems(ids: number[], purge = false) {
  const { items } = useAtlas.getState();
  if (ids.length === 1) {
    const item = items.find((i) => i.id === ids[0]);
    if (item) confirmDeleteItem(item, purge);
    return;
  }
  if (!purge) {
    void trashItems(ids);
    return;
  }
  const gone = new Set(ids);
  const up = items.filter((i) => gone.has(i.parentId) && !gone.has(i.id)).length;
  askConfirm({
    title: `彻底删除选中的 ${ids.length} 条改进点？`,
    description: up
      ? `不进回收站，删除后无法恢复。它们的 ${up} 个子改进点会上移一层，不会被删除。`
      : "不进回收站，删除后无法恢复。",
    confirmText: `彻底删除 ${ids.length} 条`,
    destructive: true,
    onConfirm: () => deleteItems(ids),
  });
}

/** The delete entry of a menu: 删除, or 彻底删除 while Shift is down. */
function DeleteMenuItem({ onDelete, count }: { onDelete(purge: boolean): void; count?: number }) {
  const purge = usePurgeKey();
  const n = count && count > 1 ? ` ${count} 条` : "";
  return (
    <ContextMenuItem
      variant="destructive"
      // The menu's select event does not say whether Shift is down: ask the key itself.
      onSelect={() => onDelete(purgeKeyDown())}
      className={cn(purge && "bg-destructive/10")}
    >
      {purge ? <Flame /> : <Trash2 />}
      {purge ? `彻底删除${n}` : `删除${n}`}
      <ContextMenuShortcut>{purge ? `${PURGE_KEY}+Delete` : "Delete"}</ContextMenuShortcut>
    </ContextMenuItem>
  );
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

/**
 * The drag under way: the row picked up; the group dragged, that row
 * alone or, picked up from the selection, the items selected not under
 * another of them, in the queue's order; they and what is under them;
 * where they would land.
 */
const useDrag = create<{ active: Item | null; group: Item[]; moving: ReadonlySet<number>; drop: Drop | null }>(() => ({
  active: null,
  group: [],
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
  /** The top-level items to do, in their order. */
  todoRoots: number[];
}

/** How many items take status when each of the group is dropped in its section, as statusChanges counts them. */
function changesOf(group: Item[], status: ItemStatus): number {
  const { items } = useAtlas.getState();
  return group.reduce((n, g) => n + statusChanges(items, g.id, status).length, 0);
}

/**
 * What dropping the group on a section does; null when nothing changes.
 * Each takes the section's status, with what statusChanges picks under it;
 * top-level items dropped on 待办 also go first among the items to do.
 */
function sectionDrop(group: Item[], section: ItemStatus): Drop | null {
  const count = changesOf(group, section);
  if (count === 0 && (section !== "todo" || !group.some((g) => g.parentId === 0))) return null;
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
 * own and its children's, the item goes to that module with them. A group
 * of several lands the same way, one after the other, but merges with no
 * row.
 */
/**
 * How much of a row, from its top and from its bottom, puts the item before
 * or after it; the middle left, 40 %, merges or puts it inside.
 */
const EDGE = 0.3;

function dropAt(x: number, y: number, dx: number, map: DropMap, group: Item[], moving: ReadonlySet<number>): Drop | null {
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
    return section ? sectionDrop(group, section) : null;
  }
  const overId = Number(el.dataset.itemId);
  const info = map.rows.get(overId);
  if (!info || moving.has(overId)) return null;
  const { row } = info;
  const r = el.getBoundingClientRect();
  const at = (y - r.top) / r.height;
  const middle: Zone = row.hasChildren ? "inside" : "merge";
  const zone: Zone = at < EDGE ? "before" : at > 1 - EDGE ? "after" : middle;
  if (zone === "merge" && group.length > 1) return null;
  if (zone === "merge" || zone === "inside") return { kind: "row", overId, zone, status: null, count: 0 };
  const first = zone === "after" && row.hasChildren && !row.collapsed && info.next?.depth === row.depth + 1 ? info.next : undefined;
  const under = zone === "after" && dx >= INDENT;
  if (under && !first) return { kind: "row", overId, zone: "child", status: null, count: 0 };
  if (row.depth === 0 && info.section === "done" && !under) return sectionDrop(group, info.section);
  if (first) {
    if (moving.has(first.item.id)) return null;
    return { kind: "row", overId: first.item.id, zone: "before", status: null, count: 0 };
  }
  // Among the top-level items doing or to do, the item becomes one of them.
  const count = row.depth === 0 ? changesOf(group, info.section) : 0;
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
 * Rows dropped on a module of the sidebar: the group and every item under
 * it go to the module. When the queue shows another module only, the rows
 * leave it: a toast says where they went.
 */
async function dropOnModule(item: Item, groupSize: number, moving: ReadonlySet<number>, moduleId: number) {
  if (!(await setItemsModule(moduleChanges(moving, moduleId), moduleId))) return;
  const { moduleFilter, modules } = useAtlas.getState();
  if (moduleFilter !== "all" && moduleFilter !== moduleId) {
    const name = moduleId ? (modules.find((m) => m.id === moduleId)?.name ?? "") : UNSORTED;
    const under = moving.size - groupSize;
    const what = groupSize > 1 ? `已把 ${groupSize} 条移到「${name}」` : `已移到「${name}」`;
    toast.success(under > 0 ? `${what}，子改进点 ${under} 条一起` : what);
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
    return { rows, todoRoots: (trees[1] ?? []).map((t) => t.root.id) };
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
    const { items, selectedIds } = useAtlas.getState();
    const forest = buildForest(items);
    const item = forest.byId.get(id)?.item;
    if (!item) return;
    // Picked up from the selection, the selection goes; another row goes alone.
    const ids = selectedIds.size > 1 && selectedIds.has(id) ? topMost(forest, inQueueOrder(items, selectedIds)) : [id];
    const group = ids.map((v) => forest.byId.get(v)!.item);
    const moving = new Set(ids.flatMap((v) => [...subtreeIds(forest, v)]));
    useDrag.setState({ active: item, group, moving, drop: null });
    document.documentElement.classList.add("dragging-rows");
    const pointer = { x: 0, y: 0 };
    if (activatorEvent instanceof PointerEvent || activatorEvent instanceof MouseEvent) {
      pointer.x = activatorEvent.clientX;
      pointer.y = activatorEvent.clientY;
    }
    const startX = pointer.x;
    const update = () => {
      const next = dropAt(pointer.x, pointer.y, pointer.x - startX, current.current, group, moving);
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
    const { active: item, group, moving, drop } = useDrag.getState();
    useDrag.setState({ active: null, group: [], moving: new Set(), drop: null });
    if (item) draggedAt = performance.now();
    if (!apply || !drop || !item) return;
    const id = item.id;
    if (drop.kind === "module") {
      void dropOnModule(item, group.length, moving, drop.moduleId);
    } else if (drop.kind === "section") {
      // The top-level ones dropped on 待办 go first among the items to do, in
      // their order: before the first one not dragged. One that is first
      // already, dragged alone, stays.
      const roots = current.current.todoRoots;
      const first = group.length === 1 && moving.has(roots[0] ?? 0) ? 0 : (roots.find((v) => !moving.has(v)) ?? 0);
      let prev = 0;
      const drops = group.map((g): ItemDrop => {
        let move: ItemDrop["move"] = null;
        if (drop.section === "todo" && g.parentId === 0 && first) {
          move = prev ? { anchorId: prev, place: "after" } : { anchorId: first, place: "before" };
          prev = g.id;
        }
        return { id: g.id, move, status: drop.count ? drop.section : null };
      });
      void dropItems(drops);
      flashRow(id);
    } else if (drop.zone === "merge") {
      void mergeItems(id, drop.overId).then((parent) => parent && flashRow(parent.id));
    } else {
      // The first lands where dropped, each next one right after the one before it; inside, each as the last child.
      const place = drop.zone === "child" ? "inside" : drop.zone;
      let prev = 0;
      const drops = group.map((g): ItemDrop => {
        const move: ItemDrop["move"] = prev && place !== "inside" ? { anchorId: prev, place: "after" } : { anchorId: drop.overId, place };
        prev = g.id;
        return { id: g.id, move, status: drop.status };
      });
      void dropItems(drops);
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

// ---- Selecting with a box ----

/** How near the top or the bottom of the queue, in px, the box being drawn scrolls it. */
const MARQUEE_EDGE = 40;
/** How far, in px, the pointer goes before a box shows. */
const MARQUEE_START = 4;

/**
 * Lets the pointer draw a box from the queue's blank ground, the rows and
 * their controls aside: the rows it spans, top to bottom, are selected as
 * it grows, on top of what was selected with Ctrl / ⌘ or Shift held. Near
 * the top or the bottom the queue scrolls. A press that does not move
 * clears the selection, as a click on the ground did. The box, drawn in
 * the content, scrolls with it.
 */
function useMarquee(viewport: RefObject<HTMLDivElement | null>, box: RefObject<HTMLDivElement | null>) {
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);

  return (e: ReactPointerEvent<HTMLDivElement>) => {
    const v = viewport.current;
    const b = box.current;
    if (!v || !b || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-queue-row], [data-queue-draft], button, a, input, textarea")) return;
    stop.current();
    e.preventDefault();
    // A field being edited saves, as when the user clicks elsewhere.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const s = useAtlas.getState();
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!add) select(0);
    const base = add ? [...s.selectedIds] : [];
    const fallback = add ? s.selectedId : 0;
    const pointer = { x: e.clientX, y: e.clientY };
    const start = { x: e.clientX - v.getBoundingClientRect().left, y: e.clientY - v.getBoundingClientRect().top + v.scrollTop };
    const id = e.pointerId;
    try {
      v.setPointerCapture(id);
    } catch {
      // A pointer that is no longer down has nothing to capture: the window's events still come.
    }
    let drawing = false;
    let frame = 0;
    let last = "";

    const draw = () => {
      frame = 0;
      const r = v.getBoundingClientRect();
      const over = pointer.y < r.top + MARQUEE_EDGE ? pointer.y - r.top - MARQUEE_EDGE : pointer.y > r.bottom - MARQUEE_EDGE ? pointer.y - r.bottom + MARQUEE_EDGE : 0;
      if (over) v.scrollTop += Math.max(-20, Math.min(20, over / 2));
      const y = Math.max(0, Math.min(v.scrollHeight, pointer.y - r.top + v.scrollTop));
      const x = Math.max(0, Math.min(v.clientWidth, pointer.x - r.left));
      const top = Math.min(start.y, y);
      const bottom = Math.max(start.y, y);
      b.style.top = `${top}px`;
      b.style.height = `${bottom - top}px`;
      b.style.left = `${Math.min(start.x, x)}px`;
      b.style.width = `${Math.abs(x - start.x)}px`;
      b.hidden = false;
      // Rows are hit by how far the box goes up and down: they span the column.
      const hit: number[] = [];
      for (const el of v.querySelectorAll<HTMLElement>("[data-queue-row]")) {
        const er = el.getBoundingClientRect();
        const at = er.top - r.top + v.scrollTop;
        if (at < bottom && at + er.height > top) hit.push(Number(el.dataset.itemId));
      }
      const ids = [...new Set([...base, ...hit])];
      const key = ids.join(",");
      if (key !== last) {
        last = key;
        // The keys go on from the row at the edge the box grows to; Shift from the one it started at.
        const down = y >= start.y;
        const lead = hit.length ? (down ? hit.at(-1)! : hit[0]!) : fallback;
        const tail = hit.length ? (down ? hit[0]! : hit.at(-1)!) : s.selectAnchor;
        setSelection(ids, lead, tail);
      }
      // Held at an edge, the queue keeps scrolling.
      if (over) frame = requestAnimationFrame(draw);
    };
    const schedule = () => {
      if (drawing && !frame) frame = requestAnimationFrame(draw);
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      pointer.x = ev.clientX;
      pointer.y = ev.clientY;
      if (!drawing && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < MARQUEE_START) return;
      drawing = true;
      schedule();
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId === id) stop.current();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    v.addEventListener("scroll", schedule);
    stop.current = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      v.removeEventListener("scroll", schedule);
      if (v.hasPointerCapture(id)) v.releasePointerCapture(id);
      b.hidden = true;
      stop.current = () => {};
    };
  };
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
  const selectedIds = useAtlas((s) => s.selectedIds);
  const flashId = useQueueUi((s) => s.flashId);
  const doneLimit = useQueueUi((s) => s.doneLimit);
  const draftAfter = useDraftAfter((s) => s.id);
  const shared = useAtlas(sharesLinks);
  const viewport = useRef<HTMLDivElement>(null);
  const marquee = useRef<HTMLDivElement>(null);
  const startMarquee = useMarquee(viewport, marquee);
  // Rows slide to where they go as their status changes, sections and
  // children open and close, and rows come and go; another project or
  // other filters show a new list at once.
  const projectId = useAtlas((s) => s.projectId);
  useFlip(viewport, `${projectId}|${typeFilter}|${moduleFilter}|${statusFilter}`);

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
  const many = selectedIds.size > 1;
  const rows = (trees: TreeRows[]) => {
    // Selected rows next to each other in a section join into one block.
    const flat = trees.flatMap((t) => t.rows);
    const picked = (i: number) => i >= 0 && i < flat.length && selectedIds.has(flat[i]!.item.id);
    let n = 0;
    return trees.flatMap((t) => {
      const out = t.rows.map((r) => {
        const i = n++;
        const selected = selectedIds.has(r.item.id);
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
            selected={selected}
            focus={r.item.id === selectedId}
            many={many}
            joinTop={selected && picked(i - 1)}
            joinBottom={selected && picked(i + 1)}
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
  };

  const filtered = typeFilter !== "all" || moduleFilter !== "all" || statusFilter !== "all";
  const nothing = doing.length + todo.length + done.length === 0;
  // With all statuses shown, each section opens and closes; filtered to one, it stays open.
  const collapsible = statusFilter === "all";
  const has = (section: ItemStatus) => statusFilter === "all" || statusFilter === section;

  return (
    <div className="flex min-h-0 flex-1 flex-col animate-in fade-in-0 duration-200">
      <Scroller ref={viewport} className="flex-1" viewportClassName="relative px-3 pt-2 pb-4" onPointerDown={startMarquee}>
        <div
          ref={marquee}
          aria-hidden
          hidden
          className="pointer-events-none absolute z-20 rounded-[4px] border border-primary/60 bg-primary/10"
        />
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
                {todo.length === 0 ? (
                  <p data-flip="todo-empty" className="px-2 py-1.5 text-xs text-muted-foreground">
                    没有待办了。
                  </p>
                ) : (
                  rows(todo)
                )}
              </QueueSection>
            )}
            {has("done") && (
              <QueueSection section="done" count={countOf(done)} collapsible={collapsible} empty={done.length === 0}>
                {rows(done.slice(0, doneLimit))}
                {done.length > doneLimit && (
                  <Button
                    data-flip="more"
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
  const toTop = useDrag((s) => section === "todo" && s.group.some((g) => g.parentId === 0));
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
      <h2 data-flip={`section-${section}`} className="flex items-center">
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
      {open && !empty && <div className="flex flex-col animate-in fade-in-0 slide-in-from-top-1 duration-200">{children}</div>}
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
  /** It is the one the keys act from. */
  focus: boolean;
  /** Several rows are selected. */
  many: boolean;
  /** The rows right above and right under it are selected too, as it is: they join into one block. */
  joinTop: boolean;
  joinBottom: boolean;
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
  focus,
  many,
  joinTop,
  joinBottom,
  flash,
}: ItemRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus || flash) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focus, flash]);
  const { setNodeRef, listeners } = useDraggable({ id: item.id });
  const zone = useDrag((s) => (s.drop?.kind === "row" && s.drop.overId === item.id ? s.drop.zone : null));
  const becomes = useDrag((s) => (s.drop?.kind === "row" && s.drop.overId === item.id ? s.drop.status : null));
  const becomesCount = useDrag((s) => (s.drop?.kind === "row" && s.drop.overId === item.id ? s.drop.count : 0));
  const moving = useDrag((s) => s.moving.has(item.id));
  // The rows picked up, not those under them: where they were shows as an outline.
  const picked = useDrag((s) => s.group.some((g) => g.id === item.id));
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
    <ContextMenu onOpenChange={(open) => open && selectForMenu(item.id)}>
      <ContextMenuTrigger asChild>
        <div
          ref={(el) => {
            ref.current = el;
            setNodeRef(el);
          }}
          {...listeners}
          data-queue-row=""
          data-item-id={item.id}
          data-flip={`item-${item.id}`}
          aria-current={focus || undefined}
          onClick={(e) => clickRow(item.id, e)}
          onDoubleClick={(e) => {
            // The circle, the arrow and the row's buttons keep their own clicks.
            if ((e.target as HTMLElement).closest("button, a, input")) return;
            if (e.ctrlKey || e.metaKey || e.shiftKey) return;
            setRenaming(true);
          }}
          style={{ paddingLeft: left }}
          className={cn(
            "signal-row group relative flex h-9 items-center gap-2 rounded-md pr-2 transition-[background-color,opacity,box-shadow,border-radius] duration-100",
            selected ? "bg-accent" : "hover:bg-accent/50",
            joinTop && "rounded-t-none",
            joinBottom && "rounded-b-none",
            // Among several, the one the keys act from has a thin line.
            focus && many && !zone && "shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_45%,transparent)]",
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
            {!isDone && <RowActions item={item} shown={selected && !many} />}
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
        <RowMenuItems item={item} />
      </ContextMenuContent>
    </ContextMenu>
  );
});

/** The right-click menu of a row: for the selection when the row is one of several selected, else for the row. */
function RowMenuItems({ item }: { item: Item }) {
  const ofSelection = useAtlas((s) => s.selectedIds.size > 1 && s.selectedIds.has(item.id));
  return ofSelection ? <SelectionMenuItems /> : <ItemMenuItems item={item} />;
}

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
  // A link to a session shows its agent, and its name in the tooltip.
  const session = useSessionLook(link);
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
          {session ? <AgentIcon agent={session.agent} /> : <Link2 className="size-3.5" />}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 break-all">
        {from && <span className="block opacity-70">沿用「{from}」的链接</span>}
        {session ? sessionLabel(session) : link}
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
            { label: "重新打开", status: "doing", icon: RotateCcw, shortcut: "Space", reopen: true },
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
      <DeleteMenuItem onDelete={(purge) => confirmDeleteItem(item, purge)} />
    </>
  );
}

/** What the right-click menu offers for several items selected, in the queue's order. It mounts only while the menu is open. */
function SelectionMenuItems() {
  const items = useAtlas((s) => s.items);
  const selectedIds = useAtlas((s) => s.selectedIds);
  const projects = useAtlas((s) => s.projects);
  const projectId = useAtlas((s) => s.projectId);
  const modules = useAtlas((s) => s.modules);
  const ids = useMemo(() => inQueueOrder(items, selectedIds), [items, selectedIds]);
  const chosen = items.filter((i) => selectedIds.has(i.id));
  const all = (status: ItemStatus) => chosen.every((i) => i.status === status);
  const others = projects.filter((p) => p.id !== projectId);
  // The module they are all in, if one.
  const module = chosen.every((i) => i.moduleId === chosen[0]?.moduleId) ? String(chosen[0]?.moduleId ?? "") : "";
  return (
    <>
      <ContextMenuLabel className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
        <ListChecks className="size-3.5" />
        已选 <span className="meta-mono">{ids.length}</span> 条
      </ContextMenuLabel>
      <ContextMenuSeparator />
      {all("done") && (
        <ContextMenuItem onSelect={() => void reopenItems(ids)}>
          <RotateCcw />
          重新打开
          <ContextMenuShortcut>Space</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {!all("doing") && (
        <ContextMenuItem onSelect={() => void setItemsStatus(ids, "doing")}>
          <Play />
          开始进行
          <ContextMenuShortcut>S</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {!all("done") && (
        <ContextMenuItem onSelect={() => void setItemsStatus(ids, "done")}>
          <CircleCheck />
          标为完成
          <ContextMenuShortcut>Space</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {!all("todo") && (
        <ContextMenuItem onSelect={() => void setItemsStatus(ids, "todo")}>
          <Pause />
          改为待办
          {all("doing") && <ContextMenuShortcut>S</ContextMenuShortcut>}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => void copyItems(ids)}>
        <Copy />
        复制给 AI
        <ContextMenuShortcut>C</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Boxes />
          移到模块
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-80 w-44 overflow-y-auto">
          <ContextMenuRadioGroup value={module} onValueChange={(v) => void setItemsModule(ids, Number(v))}>
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
            <ContextMenuItem key={p.id} onSelect={() => void moveItemsToProject(ids, p.id)}>
              <span className="truncate">{p.name}</span>
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <DeleteMenuItem count={ids.length} onDelete={(purge) => confirmDeleteItems(ids, purge)} />
    </>
  );
}

/**
 * The title, renamed in its row after a double click or Enter: Enter or
 * leaving saves, Escape gives it up, Shift+Enter saves and names a new item
 * of its level under it; with the caret inside the title, the words after it
 * go to the new item.
 */
function RowTitleInput({ item, onDone }: { item: Item; onDone(): void }) {
  const [draft, setDraft] = useState(item.title);
  const field = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  // Set by Shift+Enter: the title cut where the caret was.
  const next = useRef<{ head: string; tail: string } | null>(null);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const finish = () => {
    const cut = next.current;
    const text = (cut?.head ?? draft).trim();
    if (!cancelled.current && text && text !== item.title) void setItemTitle(item.id, text);
    onDone();
    if (cut) useDraftAfter.setState({ id: item.id, text: cut.tail, restore: cut.tail ? draft.trim() : "" });
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
          next.current = e.shiftKey ? splitAtCaret(e.currentTarget, draft) : null;
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
 * names one more under it, taking the words after the caret along. Empty,
 * Escape or leaving gives it up; Escape also puts back the words it started
 * with on the item they were cut from.
 */
function DraftRow({ after, depth, nested }: { after: Item; depth: number; nested: boolean }) {
  // Read once: the row is made anew for each item it adds under.
  const [draft, setDraft] = useState(() => draftStart().text);
  const [restore] = useState(() => draftStart().restore);
  const field = useRef<HTMLInputElement>(null);
  // Once it is being added, leaving the field must not add it twice.
  const busy = useRef(false);
  const Todo = statusInfo("todo").icon;
  useEffect(() => {
    field.current?.focus();
    field.current?.setSelectionRange(0, 0); // before the words cut off, as a new line in an editor
  }, []);

  const close = () => {
    if (useDraftAfter.getState().id === after.id) useDraftAfter.setState({ id: 0, text: "", restore: "" });
  };
  const add = async (more: boolean) => {
    const cut = more && field.current ? splitAtCaret(field.current, draft) : { head: draft, tail: "" };
    const title = cut.head.trim();
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
    if (more) useDraftAfter.setState({ id: item.id, text: cut.tail, restore: cut.tail ? draft.trim() : "" });
    else close();
  };

  return (
    <div
      data-queue-draft=""
      data-flip={`draft-${after.id}`}
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
            if (restore) void setItemTitle(after.id, restore);
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
