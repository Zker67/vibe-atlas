import { create } from "zustand";
import { toast } from "sonner";
import {
  Atlas,
  events,
  type Item,
  type ItemStatus,
  type ItemType,
  type Module,
  type Overview,
  type Place,
  type Project,
  type Settings,
} from "@/mygo";
import { errorMessage, run, runOk } from "@/lib/api";
import { ancestors, applyMove, buildForest, linkSource, queueTrees, subtreeIds, type QueueTrees, type TreeNode } from "@/lib/tree";

export type View = "queue" | "overview";
export type TypeFilter = ItemType | "all";
/** A module's id, 0 for the items without a module, or all. */
export type ModuleFilter = number | "all";
export type StatusFilter = ItemStatus | "all";

interface AtlasState {
  ready: boolean;
  loadError: string;
  projects: Project[];
  /** The project open, 0 when there is none. */
  projectId: number;
  modules: Module[];
  /** The project's items: doing, to do in the user's order, then done. */
  items: Item[];
  overview: Overview | null;
  settings: Settings | null;
  view: View;
  typeFilter: TypeFilter;
  moduleFilter: ModuleFilter;
  statusFilter: StatusFilter;
  /** The item shown in the detail panel, 0 for none. */
  selectedId: number;
  /** Which sections of the queue show their items: 进行中, 待办, 已完成. */
  sectionOpen: Readonly<Record<ItemStatus, boolean>>;
  /** Bumped to move the keyboard to the field that adds items. */
  focusNewItem: number;
  /** The items whose children the queue hides. */
  collapsed: ReadonlySet<number>;
  /** The item whose detail should open its field that adds a child, once; 0 for none. */
  newChildFor: number;
}

const COLLAPSED_KEY = "vibe-atlas-collapsed";
const SECTIONS_KEY = "vibe-atlas-sections";

function loadSectionOpen(): Record<ItemStatus, boolean> {
  const open = { doing: true, todo: true, done: false };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "{}");
    if (saved && typeof saved === "object") {
      for (const k of ["doing", "todo", "done"] as const) {
        const v = (saved as Record<string, unknown>)[k];
        if (typeof v === "boolean") open[k] = v;
      }
    }
  } catch {
    // Keep the defaults.
  }
  return open;
}

function loadCollapsed(): Set<number> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return new Set(Array.isArray(ids) ? ids.filter((v): v is number => typeof v === "number") : []);
  } catch {
    return new Set();
  }
}

export const useAtlas = create<AtlasState>(() => ({
  ready: false,
  loadError: "",
  projects: [],
  projectId: 0,
  modules: [],
  items: [],
  overview: null,
  settings: null,
  view: "queue",
  typeFilter: "all",
  moduleFilter: "all",
  statusFilter: "all",
  selectedId: 0,
  sectionOpen: loadSectionOpen(),
  focusNewItem: 0,
  collapsed: loadCollapsed(),
  newChildFor: 0,
}));

const get = useAtlas.getState;
const set = useAtlas.setState;

// ---- Loading ----

let loading: Promise<void> | null = null;
let again = false;

/**
 * Fetches the projects and what the open project shows. Calls made while a
 * fetch runs coalesce into one more fetch after it.
 */
export function refresh(): Promise<void> {
  if (loading) {
    again = true;
    return loading;
  }
  loading = (async () => {
    do {
      again = false;
      try {
        await load();
      } catch (e) {
        set({ loadError: errorMessage(e), ready: true });
      }
    } while (again);
  })().finally(() => {
    loading = null;
  });
  return loading;
}

async function load() {
  const requested = get().projectId;
  const projects = await Atlas.projects();
  const projectId = projects.some((p) => p.id === requested) ? requested : (projects[0]?.id ?? 0);
  let modules: Module[] = [];
  let items: Item[] = [];
  let overview: Overview | null = null;
  if (projectId) {
    [modules, items] = await Promise.all([Atlas.modules(projectId), Atlas.items(projectId)]);
    if (get().view === "overview") overview = await Atlas.overview(projectId);
  }
  if (get().projectId !== requested) {
    // The user opened another project meanwhile: fetch that one.
    again = true;
    set({ projects });
    return;
  }
  set((s) => ({
    ready: true,
    loadError: "",
    projects,
    projectId,
    modules,
    items,
    overview: overview ?? (s.overview?.projectId === projectId ? s.overview : null),
    selectedId: items.some((i) => i.id === s.selectedId) ? s.selectedId : 0,
    moduleFilter:
      s.moduleFilter === "all" || s.moduleFilter === 0 || modules.some((m) => m.id === s.moduleFilter)
        ? s.moduleFilter
        : "all",
  }));
  if (projectId !== requested) void Atlas.setCurrentProject(projectId);
}

let started = false;

/** Loads the app and follows the changes Go reports, from any window. */
export async function init() {
  if (started) return;
  started = true;
  events.changed.on(() => void refresh());
  events.settingsChanged.on((settings) => set({ settings }));
  try {
    const settings = await Atlas.settings();
    set({ settings, projectId: settings.currentProjectId });
  } catch (e) {
    set({ loadError: errorMessage(e), ready: true });
    return;
  }
  await refresh();
}

// ---- Navigation ----

export function openProject(id: number) {
  if (id === get().projectId) return;
  set({ projectId: id, selectedId: 0, typeFilter: "all", moduleFilter: "all", statusFilter: "all", overview: null, modules: [], items: [] });
  void Atlas.setCurrentProject(id);
  void refresh();
}

export function setView(view: View) {
  set({ view });
  if (view === "overview") void refresh();
}

export function select(id: number) {
  set({ selectedId: id });
}

/** Shows an item in the queue, from the overview: clears filters that hide it, opens its parents. */
export function showItem(item: Item) {
  expand(ancestors(buildForest(get().items), item.id).map((a) => a.id));
  const s = get();
  const hidden =
    (s.typeFilter !== "all" && s.typeFilter !== item.type) ||
    (s.moduleFilter !== "all" && s.moduleFilter !== item.moduleId);
  set({
    statusFilter: matchesStatus(item, s.statusFilter) ? s.statusFilter : "all",
    view: "queue",
    selectedId: item.id,
    ...(hidden ? { typeFilter: "all" as const, moduleFilter: "all" as const } : {}),
  });
  const section = sectionOf(item.id);
  if (section) setSectionOpen(section, true);
}

/** The queue's trees, by section, as the filters and the collapsed parents leave them. */
export function layoutQueue(
  s: Pick<AtlasState, "items" | "typeFilter" | "moduleFilter" | "statusFilter" | "collapsed">,
): QueueTrees {
  return queueTrees(
    buildForest(s.items),
    (it) => matchesFilters(it, s.typeFilter, s.moduleFilter) && matchesStatus(it, s.statusFilter),
    s.collapsed,
  );
}

/** The section of the queue an item shows in now, or undefined when it does not show. */
export function sectionOf(id: number): ItemStatus | undefined {
  const trees = layoutQueue(get());
  return (["doing", "todo", "done"] as const).find((st) => trees[st].some((t) => t.rows.some((r) => r.item.id === id)));
}

export function setTypeFilter(typeFilter: TypeFilter) {
  set({ typeFilter });
}

export function setStatusFilter(statusFilter: StatusFilter) {
  set({ statusFilter });
}

export function setModuleFilter(moduleFilter: ModuleFilter) {
  set({ moduleFilter });
}

export function clearFilters() {
  set({ typeFilter: "all", moduleFilter: "all", statusFilter: "all" });
}

/** Shows or hides the items of a section of the queue; the queue remembers it. */
export function setSectionOpen(section: ItemStatus, open = !get().sectionOpen[section]) {
  if (get().sectionOpen[section] === open) return;
  const sectionOpen = { ...get().sectionOpen, [section]: open };
  set({ sectionOpen });
  localStorage.setItem(SECTIONS_KEY, JSON.stringify(sectionOpen));
}

export function focusNewItem() {
  set((s) => ({ view: "queue", focusNewItem: s.focusNewItem + 1 }));
}

/** Selects an item and moves the keyboard to the field that adds a child to it. */
export function focusNewChild(id: number) {
  set({ view: "queue", selectedId: id, newChildFor: id });
}

/** The field under the queue stops adding children (focusNewChild). */
export function newChildTaken() {
  set({ newChildFor: 0 });
}

function saveCollapsed(collapsed: ReadonlySet<number>) {
  set({ collapsed });
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
}

/** Hides or shows the children of an item in the queue. */
export function setCollapsed(id: number, hide: boolean) {
  const { collapsed } = get();
  if (collapsed.has(id) === hide) return;
  const next = new Set(collapsed);
  if (hide) next.add(id);
  else next.delete(id);
  saveCollapsed(next);
}

export function toggleCollapsed(id: number) {
  setCollapsed(id, !get().collapsed.has(id));
}

/** Shows the children of the items ids. */
export function expand(ids: number[]) {
  const { collapsed } = get();
  if (!ids.some((id) => collapsed.has(id))) return;
  saveCollapsed(new Set([...collapsed].filter((id) => !ids.includes(id))));
}

// ---- Derived lists ----

export function matchesFilters(item: Item, typeFilter: TypeFilter, moduleFilter: ModuleFilter): boolean {
  return (typeFilter === "all" || item.type === typeFilter) && (moduleFilter === "all" || item.moduleId === moduleFilter);
}

export function matchesStatus(item: Item, statusFilter: StatusFilter): boolean {
  return statusFilter === "all" || item.status === statusFilter;
}

export interface Sections {
  doing: Item[];
  todo: Item[];
  done: Item[];
}

/** The items that show, by status, in their order. */
export function sections(items: Item[], typeFilter: TypeFilter, moduleFilter: ModuleFilter): Sections {
  const out: Sections = { doing: [], todo: [], done: [] };
  for (const it of items) {
    if (matchesFilters(it, typeFilter, moduleFilter)) out[it.status].push(it);
  }
  return out;
}

// ---- Changes ----

function mergeItem(item: Item) {
  set((s) => {
    if (item.projectId !== s.projectId) {
      return { items: s.items.filter((i) => i.id !== item.id) };
    }
    const exists = s.items.some((i) => i.id === item.id);
    return { items: exists ? s.items.map((i) => (i.id === item.id ? item : i)) : [...s.items, item] };
  });
}

function mergeProject(project: Project) {
  set((s) => ({ projects: s.projects.map((p) => (p.id === project.id ? project : p)) }));
}

/** Adds a project and opens it. Throws its error, for the dialog to show. */
export async function createProject(name: string): Promise<Project> {
  const p = await Atlas.createProject(name);
  set((s) => ({ projects: [...s.projects, p] }));
  openProject(p.id);
  return p;
}

export async function renameProject(id: number, name: string): Promise<Project> {
  const p = await Atlas.renameProject(id, name);
  mergeProject(p);
  return p;
}

export async function setProjectDescription(id: number, description: string) {
  const p = await run(Atlas.setProjectDescription(id, description));
  if (p) mergeProject(p);
}

export async function chooseProjectFolder(id: number) {
  const p = await run(Atlas.chooseProjectFolder(id));
  if (p) mergeProject(p);
}

export async function clearProjectFolder(id: number) {
  const p = await run(Atlas.clearProjectFolder(id));
  if (p) mergeProject(p);
}

export function openProjectFolder(id: number) {
  void runOk(Atlas.openProjectFolder(id));
}

export async function deleteProject(id: number) {
  if (await runOk(Atlas.deleteProject(id))) {
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
    if (get().projectId === id) {
      set({ projectId: 0, selectedId: 0, items: [], modules: [], overview: null });
    }
    void refresh();
  }
}

/** Moves a project before or after another, as dragged in the sidebar. */
export function moveProject(id: number, overId: number) {
  const ids = get().projects.map((p) => p.id);
  const order = arrayMove(ids, ids.indexOf(id), ids.indexOf(overId));
  set((s) => ({ projects: order.map((pid) => s.projects.find((p) => p.id === pid)!) }));
  void runOk(Atlas.reorderProjects(order));
}

export async function createModule(name: string): Promise<Module> {
  const m = await Atlas.createModule(get().projectId, name);
  set((s) => ({ modules: [...s.modules, m] }));
  return m;
}

export async function renameModule(id: number, name: string): Promise<Module> {
  const m = await Atlas.renameModule(id, name);
  set((s) => ({ modules: s.modules.map((x) => (x.id === id ? m : x)) }));
  return m;
}

export async function deleteModule(id: number) {
  const moved = await run(Atlas.deleteModule(id));
  if (moved === undefined) return;
  set((s) => ({
    modules: s.modules.filter((m) => m.id !== id),
    items: s.items.map((i) => (i.moduleId === id ? { ...i, moduleId: 0 } : i)),
    moduleFilter: s.moduleFilter === id ? "all" : s.moduleFilter,
  }));
}

export function moveModule(id: number, overId: number) {
  const ids = get().modules.map((m) => m.id);
  const order = arrayMove(ids, ids.indexOf(id), ids.indexOf(overId));
  set((s) => ({ modules: order.map((mid) => s.modules.find((m) => m.id === mid)!) }));
  void runOk(Atlas.reorderModules(get().projectId, order));
}

/**
 * Adds an item to the open project, under parentId unless it is 0. Throws
 * its error, for the field to show.
 */
export async function createItem(title: string, type: ItemType, moduleId: number, parentId = 0): Promise<Item> {
  const item = await Atlas.createItem({ projectId: get().projectId, parentId, moduleId, type, title });
  mergeItem(item);
  if (parentId) {
    expand([parentId]);
    // The parent's title may follow its children.
    void refresh();
  }
  return item;
}

/** Applies a change to an item and merges the result; shows errors. */
async function editItem(call: Promise<Item>): Promise<Item | undefined> {
  const item = await run(call);
  if (item) mergeItem(item);
  return item;
}

export const setItemTitle = (id: number, title: string) => editItem(Atlas.setItemTitle(id, title));
export const setItemType = (id: number, type: ItemType) => editItem(Atlas.setItemType(id, type));
export const setItemModule = (id: number, moduleId: number) => editItem(Atlas.setItemModule(id, moduleId));
export const setItemNote = (id: number, note: string) => editItem(Atlas.setItemNote(id, note));

/** Binds a link to an item. Throws its error, for the field to show. */
export async function setItemDeeplink(id: number, link: string): Promise<Item> {
  const item = await Atlas.setItemDeeplink(id, link);
  mergeItem(item);
  return item;
}

/** Gives the one item a status, as Go stamps it. */
async function applyStatus(id: number, status: ItemStatus) {
  await editItem(Atlas.setItemStatus(id, status));
}

/**
 * Gives an item a status, with the items under it that statusPlan takes
 * along: done takes everything under it not done yet; reopened, a done
 * parent takes the done items under it back to do.
 */
export async function setItemStatus(id: number, status: ItemStatus) {
  const items = get().items;
  const plan = statusPlan(items, id, status, false);
  const start = startMove(items, id, plan);
  await applyChange(start ? [start] : [], plan);
}

/** A move of an item, with those under it, as Store.MoveItem makes it. */
interface Move {
  id: number;
  anchorId: number;
  place: Place;
}

/**
 * Where the tree of id goes when plan starts something in it: right after
 * the last other tree doing, so that 进行中 lists trees in the order they
 * started until the user drags them. Null when the plan starts nothing,
 * when the tree is in 进行中 already, or when no other tree is.
 */
function startMove(items: Item[], id: number, plan: ReadonlyMap<number, ItemStatus>): Move | null {
  if (![...plan.values()].includes("doing")) return null;
  const forest = buildForest(items);
  let root = forest.byId.get(id);
  while (root?.parent) root = root.parent;
  if (!root) return null;
  const doing = (n: TreeNode): boolean => n.item.status === "doing" || n.children.some(doing);
  if (doing(root)) return null;
  let last: TreeNode | undefined;
  for (const r of forest.roots) if (r !== root && doing(r)) last = r;
  return last ? { id: root.item.id, anchorId: last.item.id, place: "after" } : null;
}

/**
 * Shows a change at once, the moves then the statuses of the plan, and has
 * Go apply it in that order, the plan the top first. reopenId is the done
 * item the plan takes back to the status it had: it keeps when it started.
 */
async function applyChange(moves: Move[], plan: ReadonlyMap<number, ItemStatus>, reopenId = 0) {
  if (moves.length === 0 && plan.size === 0) return;
  let items = get().items;
  for (const m of moves) items = applyMove(items, m.id, m.anchorId, m.place) ?? items;
  items = items.map((i) => {
    const to = plan.get(i.id);
    if (!to) return i;
    return i.id === reopenId ? { ...i, status: to, doneAt: 0 } : withStatus(i, to);
  });
  set({ items });
  for (const m of moves) {
    if (m.place === "inside") expand([m.anchorId]);
    if (!(await runOk(Atlas.moveItem(m.id, m.anchorId, m.place)))) {
      void refresh();
      return;
    }
  }
  for (const [v, to] of plan) {
    if (v === reopenId) await editItem(Atlas.reopenItem(v));
    else await applyStatus(v, to);
  }
}

/**
 * The status a done item goes back to: doing when it was done while doing,
 * as StartedAt tells (going back to do clears it); else to do.
 */
export const reopenStatus = (item: Item): ItemStatus => (item.startedAt ? "doing" : "todo");

/**
 * Takes a done item back to the status it had before, as reopenStatus
 * says, with the done items under it back to do, as statusPlan has it.
 * Back to doing, its tree goes to the end of 进行中, as when it starts.
 */
export async function reopenItem(id: number) {
  const items = get().items;
  const item = items.find((i) => i.id === id);
  if (item?.status !== "done") return;
  const plan = statusPlan(items, id, reopenStatus(item), false);
  const start = startMove(items, id, plan);
  await applyChange(start ? [start] : [], plan, id);
}

/** The status a click on an item's circle gives it: done, or back to the status before. */
export function toggleItemDone(item: Item) {
  if (item.status === "done") void reopenItem(item.id);
  else void setItemStatus(item.id, "done");
}

/** Starts an item, or puts a doing one back to do. */
export function toggleItemDoing(item: Item) {
  void setItemStatus(item.id, item.status === "doing" ? "todo" : "doing");
}

/**
 * Moves an item, with those under it, before or after another or inside it,
 * as dropped in the queue. The queue shows the move at once.
 */
export function moveItem(id: number, anchorId: number, place: Place) {
  void dropItem(id, { anchorId, place }, null);
}

/** An item as it is once its status became status, as SetItemStatus stamps it. */
function withStatus(item: Item, status: ItemStatus): Item {
  if (item.status === status) return item;
  const now = Date.now();
  switch (status) {
    case "doing":
      return { ...item, status, startedAt: now, doneAt: 0 };
    case "done":
      return { ...item, status, doneAt: now };
    case "todo":
      return { ...item, status, startedAt: 0, doneAt: 0 };
  }
}

/**
 * The items whose status changes when id gets status, and what each gets,
 * the top first: id itself; done, also everything under it not done yet;
 * id done and reopened (to do or doing), the done items under it, back to
 * do. Dropped (drop) in 待办, also those under it that are doing go back to
 * do, so that its tree lands there.
 */
export function statusPlan(items: Item[], id: number, status: ItemStatus, drop: boolean): Map<number, ItemStatus> {
  const forest = buildForest(items);
  const plan = new Map<number, ItemStatus>();
  const root = forest.byId.get(id)?.item;
  if (!root) return plan;
  const reopen = root.status === "done" && status !== "done";
  for (const v of subtreeIds(forest, id)) {
    const it = forest.byId.get(v)!.item;
    let to: ItemStatus | null = null;
    if (v === id || status === "done") to = status;
    else if (reopen && it.status === "done") to = "todo";
    else if (drop && status === "todo" && it.status === "doing") to = "todo";
    if (to && to !== it.status) plan.set(v, to);
  }
  return plan;
}

/**
 * The items that take status when id is dropped in its section, as the
 * drop marks count them: see statusPlan.
 */
export function statusChanges(items: Item[], id: number, status: ItemStatus): number[] {
  return [...statusPlan(items, id, status, true)].filter(([, to]) => to === status).map(([v]) => v);
}

/**
 * What a drop in the queue does: moves the item, then gives it the status
 * of the section it was dropped in, with what statusPlan takes along under
 * it; either step is optional. The queue shows both at once; Go applies
 * them in that order.
 */
export async function dropItem(id: number, move: { anchorId: number; place: Place } | null, status: ItemStatus | null) {
  const items = get().items;
  const plan = status ? statusPlan(items, id, status, true) : new Map<number, ItemStatus>();
  // Put where the user dropped it, the item stays there; started from the
  // title of 进行中, its tree goes to the end of it.
  const start = move ? null : startMove(items, id, plan);
  const moves = move ? [{ id, ...move }] : start ? [start] : [];
  await applyChange(moves, plan);
}

/** Puts id and targetId under a new parent in the target's place, and selects the parent. */
export async function mergeItems(id: number, targetId: number): Promise<Item | undefined> {
  const parent = await run(Atlas.mergeItems(id, targetId));
  if (!parent) return;
  await refresh();
  set({ selectedId: parent.id });
  return parent;
}

export async function moveItemToProject(id: number, projectId: number) {
  const item = await run(Atlas.moveItemToProject(id, projectId));
  if (!item) return;
  const project = get().projects.find((p) => p.id === projectId);
  // The items under it go along.
  const gone = subtreeIds(buildForest(get().items), id);
  set((s) => ({ items: s.items.filter((i) => !gone.has(i.id)), selectedId: gone.has(s.selectedId) ? 0 : s.selectedId }));
  toast.success(`已移到「${project?.name ?? "另一个项目"}」`);
}

export async function deleteItem(id: number) {
  if (await runOk(Atlas.deleteItem(id))) {
    set((s) => ({ items: s.items.filter((i) => i.id !== id), selectedId: s.selectedId === id ? 0 : s.selectedId }));
    // Its children moved up into its place.
    void refresh();
  }
}

export async function copyItem(id: number) {
  if (await runOk(Atlas.copyItem(id))) toast.success("已复制，可以粘贴给 AI 了");
}

export function openDeeplink(id: number) {
  void runOk(Atlas.openDeeplink(id));
}

/** Whether sub-items without a link of their own open the link of an item above them. */
export const sharesLinks = (s: Pick<AtlasState, "settings">) => s.settings?.shareLinks ?? true;

/** The item whose link the item opens, as linkSource finds it with the settings now. */
function linkSourceIn(s: Pick<AtlasState, "items" | "settings">, id: number): Item | null {
  const item = s.items.find((i) => i.id === id);
  if (!item || item.deeplink || !item.parentId || !sharesLinks(s)) return item?.deeplink ? item : null;
  return linkSource(new Map(s.items.map((i) => [i.id, i])), id, true);
}

/** The item whose link id opens now: itself, an item above it, or null for none. */
export const itemLinkSource = (id: number) => linkSourceIn(get(), id);

/** itemLinkSource, kept up to date. */
export const useLinkSource = (id: number) => useAtlas((s) => linkSourceIn(s, id));

export function openLink(link: string) {
  void runOk(Atlas.openLink(link));
}

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice();
  if (from < 0 || to < 0) return out;
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved!);
  return out;
}
