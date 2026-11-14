import { create } from "zustand";
import { toast } from "sonner";
import {
  Atlas,
  events,
  type Dep,
  type Item,
  type ItemStatus,
  type ItemType,
  type Module,
  type Overview,
  type Place,
  type Project,
  type ProjectDraft,
  type Settings,
  type TrashEntry,
} from "@/mygo";
import { errorMessage, run, runOk } from "@/lib/api";
import { brokenByMove } from "@/lib/deps";
import {
  ancestors,
  applyMove,
  buildForest,
  linkSource,
  queueOrder,
  queueTrees,
  subtreeIds,
  topMost,
  type QueueTrees,
  type TreeNode,
} from "@/lib/tree";

/** What the panel shows: the open project's queue, flow chart or overview, or the trash of every project. */
export type View = "queue" | "flow" | "overview" | "trash";
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
  /** The prerequisites between the project's items: each toId waits for its fromId. */
  deps: Dep[];
  overview: Overview | null;
  settings: Settings | null;
  view: View;
  typeFilter: TypeFilter;
  moduleFilter: ModuleFilter;
  statusFilter: StatusFilter;
  /**
   * The item the keys act from, 0 for none: the one the detail panel shows
   * while it is the only one selected. With several selected, it is one of
   * them, the one clicked last.
   */
  selectedId: number;
  /** The items selected in the queue, selectedId among them. */
  selectedIds: ReadonlySet<number>;
  /** Where Shift+click and Shift+↑↓ select from. */
  selectAnchor: number;
  /** Which sections of the queue show their items: 进行中, 待办, 已完成. */
  sectionOpen: Readonly<Record<ItemStatus, boolean>>;
  /** Bumped to move the keyboard to the field that adds items. */
  focusNewItem: number;
  /** The items whose children the queue hides. */
  collapsed: ReadonlySet<number>;
  /** The item whose detail should open its field that adds a child, once; 0 for none. */
  newChildFor: number;
  /** How many items the trash holds, of every project. */
  trashCount: number;
  /** What the trash holds, the last deleted first; fetched while it shows. */
  trash: TrashEntry[];
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
  deps: [],
  overview: null,
  settings: null,
  view: "queue",
  typeFilter: "all",
  moduleFilter: "all",
  statusFilter: "all",
  selectedId: 0,
  selectedIds: new Set<number>(),
  selectAnchor: 0,
  sectionOpen: loadSectionOpen(),
  focusNewItem: 0,
  collapsed: loadCollapsed(),
  newChildFor: 0,
  trashCount: 0,
  trash: [],
}));

const get = useAtlas.getState;
const set = useAtlas.setState;

const NONE: ReadonlySet<number> = new Set();

/** The selection with only id in it, or nothing for 0; Shift+click goes on from it. */
function only(id: number): Pick<AtlasState, "selectedId" | "selectedIds" | "selectAnchor"> {
  return { selectedId: id, selectedIds: id ? new Set([id]) : NONE, selectAnchor: id };
}

/** The selection without the items keep turns down; the same one when none goes. */
function keepSelected(
  s: Pick<AtlasState, "selectedId" | "selectedIds">,
  keep: (id: number) => boolean,
): Pick<AtlasState, "selectedId" | "selectedIds"> {
  if ([...s.selectedIds].every(keep) && (s.selectedId === 0 || keep(s.selectedId))) {
    return { selectedId: s.selectedId, selectedIds: s.selectedIds };
  }
  const selectedIds = new Set([...s.selectedIds].filter(keep));
  const selectedId = s.selectedId && keep(s.selectedId) ? s.selectedId : ([...selectedIds].at(-1) ?? 0);
  return { selectedId, selectedIds: selectedIds.size ? selectedIds : NONE };
}

// ---- Loading ----

let loading: Promise<void> | null = null;
let again = false;

let holds = 0;
let missed = false;

/**
 * Runs fn with the fetches that the changes Go reports start held back,
 * then makes one, if any came meanwhile: for steps that Go applies one by
 * one, which would show half done.
 */
async function holdRefresh(fn: () => Promise<void>) {
  holds++;
  try {
    await fn();
  } finally {
    holds--;
    if (holds === 0 && missed) {
      missed = false;
      void refresh();
    }
  }
}

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
  const [projects, trashCount, trash] = await Promise.all([
    Atlas.projects(),
    Atlas.trashCount(),
    get().view === "trash" ? Atlas.trash() : null,
  ]);
  const projectId = projects.some((p) => p.id === requested) ? requested : (projects[0]?.id ?? 0);
  let modules: Module[] = [];
  let items: Item[] = [];
  let deps: Dep[] = [];
  let overview: Overview | null = null;
  if (projectId) {
    [modules, items, deps] = await Promise.all([Atlas.modules(projectId), Atlas.items(projectId), Atlas.deps(projectId)]);
    if (get().view === "overview") overview = await Atlas.overview(projectId);
  }
  if (get().projectId !== requested) {
    // The user opened another project meanwhile: fetch that one.
    again = true;
    set({ projects, trashCount, ...(trash ? { trash } : {}) });
    return;
  }
  const present = new Set(items.map((i) => i.id));
  set((s) => ({
    ready: true,
    loadError: "",
    projects,
    trashCount,
    ...(trash ? { trash } : {}),
    projectId,
    modules,
    items,
    deps,
    overview: overview ?? (s.overview?.projectId === projectId ? s.overview : null),
    ...keepSelected(s, (id) => present.has(id)),
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
  events.changed.on(() => {
    if (holds) missed = true;
    else void refresh();
  });
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
  leaveTrash();
  if (id === get().projectId) return;
  set({ projectId: id, ...only(0), typeFilter: "all", moduleFilter: "all", statusFilter: "all", overview: null, modules: [], items: [], deps: [] });
  void Atlas.setCurrentProject(id);
  void refresh();
}

export function setView(view: View) {
  set({ view });
  if (view === "overview" || view === "trash") void refresh();
}

/** Back to the project's queue from the trash, as picking a project or module in the sidebar does. */
function leaveTrash() {
  if (get().view === "trash") set({ view: "queue" });
}

/** Selects the item alone, or nothing for 0. */
export function select(id: number) {
  set(only(id));
}

/**
 * Selects the items ids, cursor the one the keys act from (the last of ids
 * when it is not one of them), and anchor where Shift goes on from.
 */
export function setSelection(ids: Iterable<number>, cursor: number, anchor = get().selectAnchor) {
  const selectedIds = new Set(ids);
  const selectedId = selectedIds.has(cursor) ? cursor : ([...selectedIds].at(-1) ?? 0);
  set({ selectedIds: selectedIds.size ? selectedIds : NONE, selectedId, selectAnchor: anchor });
}

/** Ctrl+click: adds the item to the selection or takes it out; Shift goes on from it. */
export function toggleSelected(id: number) {
  const s = get();
  const next = new Set(s.selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  const cursor = next.has(id) ? id : next.has(s.selectedId) ? s.selectedId : ([...next].at(-1) ?? 0);
  setSelection(next, cursor, id);
}

/** ids in the queue's order, top to bottom, as it shows with nothing filtered or collapsed. */
export function inQueueOrder(items: Item[], ids: Iterable<number>): number[] {
  const at = queueOrder(buildForest(items));
  const list = [...new Set(ids)].filter((id) => at.has(id));
  list.sort((a, b) => at.get(a)! - at.get(b)!);
  return list;
}

/** The ids of the items selected, in the queue's order. */
export function selectedInOrder(): number[] {
  const s = get();
  return inQueueOrder(s.items, s.selectedIds);
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
    ...only(item.id),
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
  leaveTrash();
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
  set({ view: "queue", ...only(id), newChildFor: id });
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

/** Adds a project as the project dialog fills it in, and opens it. Throws its error, for the dialog to show. */
export async function addProject(draft: ProjectDraft): Promise<Project> {
  const p = await Atlas.addProject(draft);
  set((s) => ({ projects: [...s.projects, p] }));
  openProject(p.id);
  return p;
}

/** Saves the name, folder and icon of a project. Throws its error, for the dialog to show. */
export async function editProject(id: number, draft: ProjectDraft): Promise<Project> {
  const p = await Atlas.editProject(id, draft);
  mergeProject(p);
  return p;
}

/** Sets the icon chosen for a project, "" for 自动. */
export async function setProjectIcon(id: number, icon: string) {
  const p = await run(Atlas.setProjectIcon(id, icon));
  if (p) mergeProject(p);
  return p;
}

/** Looks again for the project's own icon in its folder. */
export async function detectProjectIcon(id: number) {
  const p = await run(Atlas.detectProjectIcon(id));
  if (p) mergeProject(p);
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
      set({ projectId: 0, ...only(0), items: [], modules: [], deps: [], overview: null });
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

/** Sets the icon chosen for a module, "" for the default. */
export async function setModuleIcon(id: number, icon: string) {
  const m = await run(Atlas.setModuleIcon(id, icon));
  if (m) set((s) => ({ modules: s.modules.map((x) => (x.id === id ? m : x)) }));
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
 * Gives an item a status, with the items under it that statusChange takes
 * along: done carries everything under it not done yet; taken out of done,
 * it takes back what it carried.
 */
export async function setItemStatus(id: number, status: ItemStatus) {
  await applySteps([{ kind: "status", id, status }]);
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

/** A change to one item: a status given by hand, a reopening, or a drop in the queue. */
type Step =
  | { kind: "status"; id: number; status: ItemStatus }
  | { kind: "reopen"; id: number }
  | { kind: "drop"; id: number; move: { anchorId: number; place: Place } | null; status: ItemStatus | null };

/** What a step does: the moves, then the statuses. */
interface Plan {
  moves: Move[];
  change: StatusChange | null;
}

/** What the step does to the items as they are; null when it changes nothing. */
function planStep(items: Item[], step: Step): Plan | null {
  let change: StatusChange | null = null;
  let moves: Move[] = [];
  switch (step.kind) {
    case "status": {
      change = statusChange(items, step.id, step.status, false);
      const start = startMove(items, step.id, change.plan);
      moves = start ? [start] : [];
      break;
    }
    case "reopen": {
      const item = items.find((i) => i.id === step.id);
      if (item?.status !== "done") return null;
      change = statusChange(items, step.id, reopenStatus(item), false, true);
      const start = startMove(items, step.id, change.plan);
      moves = start ? [start] : [];
      break;
    }
    case "drop": {
      change = step.status ? statusChange(items, step.id, step.status, true) : null;
      // Put where the user dropped it, the item stays there; started from the
      // title of 进行中, its tree goes to the end of it.
      const start = step.move || !change ? null : startMove(items, step.id, change.plan);
      moves = step.move ? [{ id: step.id, ...step.move }] : start ? [start] : [];
      break;
    }
  }
  if (moves.length === 0 && !change?.plan.size) return null;
  return { moves, change };
}

/** The items as they are once Go applied the plan: the moves, then the statuses. */
function planned(items: Item[], { moves, change }: Plan): Item[] {
  const plan = change?.plan ?? new Map<number, ItemStatus>();
  const byGo = (v: number, to: ItemStatus) => change?.carried.get(v) === to;
  for (const m of moves) items = applyMove(items, m.id, m.anchorId, m.place) ?? items;
  return items.map((i) => {
    const to = plan.get(i.id);
    if (!to || !change) return i;
    if (byGo(i.id, to)) {
      return to === "done" ? { ...withStatus(i, to), doneWith: change.id } : { ...i, status: to, doneAt: 0, doneWith: 0 };
    }
    if (i.id === change.id && change.reopen) return { ...i, status: to, doneAt: 0, doneWith: 0 };
    return { ...withStatus(i, to), doneWith: 0 };
  });
}

/**
 * Has Go apply the plan in its order: the moves; the item with what Go
 * carries along with it, in one call; then, one by one, what else the plan
 * gives a status to. False when a move failed.
 */
async function send({ moves, change }: Plan): Promise<boolean> {
  for (const m of moves) {
    if (!(await runOk(Atlas.moveItem(m.id, m.anchorId, m.place)))) return false;
  }
  if (!change) return true;
  const { plan } = change;
  const byGo = (v: number, to: ItemStatus) => change.carried.get(v) === to;
  if (plan.has(change.id) || [...plan].some(([v, to]) => byGo(v, to))) {
    await editItem(change.reopen ? Atlas.reopenItem(change.id) : Atlas.setItemStatus(change.id, change.status));
  }
  for (const [v, to] of plan) if (v !== change.id && !byGo(v, to)) await applyStatus(v, to);
  return true;
}

/**
 * Makes the steps, each on the items as those before it left them: shows
 * what they all change at once, then has Go apply them in that order, the
 * fetches held back until the end. A move that fails stops the rest, and
 * what Go has is fetched.
 */
async function applySteps(steps: Step[]) {
  let items = get().items;
  const plans: Plan[] = [];
  for (const step of steps) {
    const p = planStep(items, step);
    if (!p) continue;
    items = planned(items, p);
    plans.push(p);
  }
  if (plans.length === 0) return;
  set({ items });
  expand(plans.flatMap((p) => p.moves.filter((m) => m.place === "inside").map((m) => m.anchorId)));
  await holdRefresh(async () => {
    for (const p of plans) {
      if (!(await send(p))) {
        void refresh();
        return;
      }
    }
  });
}

/**
 * The status a done item goes back to: doing when it was done while doing,
 * as StartedAt tells (going back to do clears it); else to do.
 */
export const reopenStatus = (item: Item): ItemStatus => (item.startedAt ? "doing" : "todo");

/**
 * Takes a done item back to the status it had before, as reopenStatus
 * says, with what its completion carried, as statusChange has it. Back to
 * doing, its tree goes to the end of 进行中, as when it starts.
 */
export async function reopenItem(id: number) {
  await applySteps([{ kind: "reopen", id }]);
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

/** What giving an item a status changes; see statusChange. */
interface StatusChange {
  id: number;
  status: ItemStatus;
  /** Taken back to the status it had, by Store.ReopenItem: it keeps when it started. */
  reopen: boolean;
  /** The items whose status changes, and what each gets, the top first. */
  plan: Map<number, ItemStatus>;
  /** The items under id that Go changes by itself along with it, and what each gets. */
  carried: Map<number, ItemStatus>;
}

/**
 * What giving id status changes, as Store.SetItemStatus and ReopenItem do
 * it: done, id carries every item under it not done yet, marked doneWith
 * it; taken out of done, it takes those it carried, still done and under
 * it, back to the status they had, as reopenStatus says. Items done on
 * their own, or changed by hand since, stay as they are. Dropped (drop) in
 * 待办, the items under it doing, or going back to doing, go back to do
 * too, so that its tree lands there.
 */
function statusChange(items: Item[], id: number, status: ItemStatus, drop: boolean, reopen = false): StatusChange {
  const forest = buildForest(items);
  const change: StatusChange = { id, status, reopen, plan: new Map(), carried: new Map() };
  const root = forest.byId.get(id)?.item;
  if (!root) return change;
  const leaving = root.status === "done" && status !== "done";
  for (const v of subtreeIds(forest, id)) {
    const it = forest.byId.get(v)!.item;
    let to: ItemStatus | null = null;
    if (v === id) to = status;
    else if (status === "done" && it.status !== "done") to = "done";
    else if (leaving && it.status === "done" && it.doneWith === id) to = reopenStatus(it);
    if (v !== id && to) change.carried.set(v, to);
    if (drop && status === "todo" && (to ?? it.status) === "doing") to = "todo";
    if (to && to !== it.status) change.plan.set(v, to);
  }
  return change;
}

/**
 * The items that take status when id is dropped in its section, as the
 * drop marks count them: see statusChange.
 */
export function statusChanges(items: Item[], id: number, status: ItemStatus): number[] {
  return [...statusChange(items, id, status, true).plan].filter(([, to]) => to === status).map(([v]) => v);
}

/**
 * What a drop in the queue does: moves the item, then gives it the status
 * of the section it was dropped in, with what statusChange takes along
 * under it; either step is optional. The queue shows both at once; Go
 * applies them in that order.
 */
export async function dropItem(id: number, move: { anchorId: number; place: Place } | null, status: ItemStatus | null) {
  await applySteps([{ kind: "drop", id, move, status }]);
}

/** One of the drops of dropItems. */
export interface Drop {
  id: number;
  move: { anchorId: number; place: Place } | null;
  status: ItemStatus | null;
}

/** Drops several items, one after the other, each as dropItem does it: a group dragged in the queue. */
export async function dropItems(drops: Drop[]) {
  await applySteps(drops.map((d) => ({ kind: "drop", ...d })));
}

/** Puts id and targetId under a new parent in the target's place, and selects the parent. */
export async function mergeItems(id: number, targetId: number): Promise<Item | undefined> {
  const parent = await run(Atlas.mergeItems(id, targetId));
  if (!parent) return;
  await refresh();
  set(only(parent.id));
  return parent;
}

export async function moveItemToProject(id: number, projectId: number) {
  // The items under it go along; prerequisites with the items left behind break.
  const gone = subtreeIds(buildForest(get().items), id);
  const broken = brokenByMove(get().deps, gone);
  const item = await run(Atlas.moveItemToProject(id, projectId));
  if (!item) return;
  const project = get().projects.find((p) => p.id === projectId);
  set((s) => ({ items: s.items.filter((i) => !gone.has(i.id)), ...keepSelected(s, (v) => !gone.has(v)) }));
  toast.success(`已移到「${project?.name ?? "另一个项目"}」${brokenText(broken)}`);
}

/** What a move to another project adds to its toast about the prerequisites it broke. */
function brokenText(n: number): string {
  return n > 0 ? `，断开了 ${n} 条前置关系` : "";
}

export async function deleteItem(id: number) {
  if (await runOk(Atlas.deleteItem(id))) {
    set((s) => ({ items: s.items.filter((i) => i.id !== id), ...keepSelected(s, (v) => v !== id) }));
    // Its children moved up into its place.
    void refresh();
  }
}

export async function copyItem(id: number) {
  if (await runOk(Atlas.copyItem(id))) toast.success("已复制，可以粘贴给 AI 了");
}

// ---- Several items at once ----

/**
 * Gives the items ids a status, as setItemStatus does each, top to bottom.
 * Done, those under another of them are left to it, which carries them.
 */
export async function setItemsStatus(ids: number[], status: ItemStatus) {
  const { items } = get();
  let list = inQueueOrder(items, ids);
  if (status === "done") list = topMost(buildForest(items), list);
  await applySteps(list.map((id) => ({ kind: "status", id, status })));
}

/** Takes the done items of ids back to the status they had before, as reopenItem does each. */
export async function reopenItems(ids: number[]) {
  await applySteps(inQueueOrder(get().items, ids).map((id) => ({ kind: "reopen", id })));
}

function itemsOf(ids: number[]): Item[] {
  const wanted = new Set(ids);
  return get().items.filter((i) => wanted.has(i.id));
}

/** Space on several: when all are done they reopen, else they are all done. */
export function toggleItemsDone(ids: number[]) {
  if (itemsOf(ids).every((i) => i.status === "done")) void reopenItems(ids);
  else void setItemsStatus(ids, "done");
}

/** S on several: when all are doing they go back to do, else those not doing start. */
export function toggleItemsDoing(ids: number[]) {
  const items = itemsOf(ids);
  if (items.every((i) => i.status === "doing")) void setItemsStatus(ids, "todo");
  else void setItemsStatus(items.filter((i) => i.status !== "doing").map((i) => i.id), "doing");
}

/** Merges the items Go returned; those now in another project leave. */
function mergeAll(list: Item[]) {
  const byId = new Map(list.map((i) => [i.id, i]));
  set((s) => ({
    items: s.items.flatMap((i) => {
      const it = byId.get(i.id);
      if (!it) return [i];
      return it.projectId === s.projectId ? [it] : [];
    }),
  }));
}

export async function setItemsType(ids: number[], type: ItemType) {
  const items = await run(Atlas.setItemsType(ids, type));
  if (items) mergeAll(items);
}

/** Puts the items ids, these only, in a module; false when it failed. */
export async function setItemsModule(ids: number[], moduleId: number): Promise<boolean> {
  const items = await run(Atlas.setItemsModule(ids, moduleId));
  if (items) mergeAll(items);
  return !!items;
}

/** Moves the items ids to another project, with those under them, in the queue's order. */
export async function moveItemsToProject(ids: number[], projectId: number) {
  const { items, deps } = get();
  const list = inQueueOrder(items, ids);
  const forest = buildForest(items);
  const top = topMost(forest, list);
  const gone = new Set(top.flatMap((id) => [...subtreeIds(forest, id)]));
  const broken = brokenByMove(deps, gone);
  if (!(await run(Atlas.moveItemsToProject(list, projectId)))) return;
  set((s) => ({ items: s.items.filter((i) => !gone.has(i.id)), ...keepSelected(s, (v) => !gone.has(v)) }));
  const name = get().projects.find((p) => p.id === projectId)?.name ?? "另一个项目";
  const under = gone.size - top.length;
  toast.success(`已把 ${top.length} 条移到「${name}」${under > 0 ? `，子改进点 ${under} 条一起` : ""}${brokenText(broken)}`);
}

/** Deletes the items ids for good, past the trash; their children not deleted move up. */
export async function deleteItems(ids: number[]) {
  if (await runOk(Atlas.deleteItems(ids))) {
    const gone = new Set(ids);
    set((s) => ({ items: s.items.filter((i) => !gone.has(i.id)), ...keepSelected(s, (v) => !gone.has(v)) }));
    void refresh();
  }
}

// ---- Prerequisites ----

/** Makes toId wait for fromId; false after showing why it cannot. */
export async function addDep(fromId: number, toId: number): Promise<boolean> {
  const dep = await run(Atlas.addDep(fromId, toId));
  if (!dep) return false;
  set((s) => ({
    deps: s.deps.some((d) => d.fromId === fromId && d.toId === toId) ? s.deps : [...s.deps, dep],
  }));
  return true;
}

/** Makes toId no longer wait for fromId; false after showing why it failed. */
export async function removeDep(fromId: number, toId: number): Promise<boolean> {
  set((s) => ({ deps: s.deps.filter((d) => d.fromId !== fromId || d.toId !== toId) }));
  if (await runOk(Atlas.removeDep(fromId, toId))) return true;
  void refresh();
  return false;
}

// ---- Trash ----

/** The deletion Ctrl+Z undoes: the batch the trash took last, 0 for none. */
let lastBatch = 0;
/** When lastBatch went to the trash, 0 for none. */
let lastBatchAt = 0;

/** When the deletion Ctrl+Z undoes went to the trash, 0 for none: the flow chart undoes its own steps made since. */
export const lastTrashAt = () => (lastBatch ? lastBatchAt : 0);

/**
 * Moves the items ids to the trash, in the queue's order, with nothing to
 * confirm: their children not deleted move up, and a toast offers to undo.
 */
export async function trashItems(ids: number[]) {
  const list = inQueueOrder(get().items, ids);
  if (list.length === 0) return;
  const title = list.length === 1 ? get().items.find((i) => i.id === list[0])?.title : undefined;
  const batch = await run(Atlas.trashItems(list));
  if (batch === undefined) return;
  lastBatch = batch;
  lastBatchAt = Date.now();
  const gone = new Set(list);
  set((s) => ({
    items: s.items.filter((i) => !gone.has(i.id)),
    ...keepSelected(s, (v) => !gone.has(v)),
    trashCount: s.trashCount + list.length,
  }));
  // Its children moved up into its place.
  void refresh();
  toast(title ? `「${clip(title)}」已移到回收站` : `已把 ${list.length} 条移到回收站`, {
    id: "trashed",
    action: { label: "撤销", onClick: () => void restoreBatch(batch) },
  });
}

/** Ctrl+Z: puts back what the last deletion moved to the trash; false when there is none to undo. */
export function undoTrash(): boolean {
  if (!lastBatch) return false;
  void restoreBatch(lastBatch);
  return true;
}

/** Puts back the items deleted together in batch, where they were, and selects them. */
async function restoreBatch(batch: number) {
  if (batch === lastBatch) lastBatch = 0;
  toast.dismiss("trashed");
  const items = await run(Atlas.restoreBatch(batch));
  if (!items?.length) return;
  await refresh();
  const here = items.filter((i) => i.projectId === get().projectId).map((i) => i.id);
  if (here.length && get().view === "queue") setSelection(here, here.at(-1)!, here[0]);
  toast.success(items.length === 1 ? "已撤销删除" : `已撤销删除，${items.length} 条已放回原处`);
}

/** Restores the trash entries ids, then offers to show them in their project. */
export async function restoreTrash(ids: number[]) {
  const items = await run(Atlas.restoreTrash(ids));
  if (!items?.length) return;
  const gone = new Set(ids);
  set((s) => ({ trash: s.trash.filter((e) => !gone.has(e.id)), trashCount: Math.max(0, s.trashCount - ids.length) }));
  void refresh();
  const first = items[0]!;
  const name = get().projects.find((p) => p.id === first.projectId)?.name;
  const where = items.every((i) => i.projectId === first.projectId) && name ? `「${name}」` : "原来的项目";
  toast.success(items.length === 1 ? `「${clip(first.title)}」已恢复到${where}` : `已把 ${items.length} 条恢复到${where}`, {
    action: { label: "查看", onClick: () => void showRestored(first) },
  });
}

/** Opens the project of an item put back, and shows it in the queue. */
async function showRestored(item: Item) {
  openProject(item.projectId);
  set({ view: "queue" });
  await refresh();
  const it = get().items.find((i) => i.id === item.id);
  if (it) showItem(it);
}

/** Deletes the trash entries ids for good. */
export async function purgeTrash(ids: number[]) {
  if (!(await runOk(Atlas.purgeTrash(ids)))) return;
  const gone = new Set(ids);
  set((s) => ({ trash: s.trash.filter((e) => !gone.has(e.id)), trashCount: Math.max(0, s.trashCount - ids.length) }));
  toast.success(ids.length === 1 ? "已彻底删除" : `已彻底删除 ${ids.length} 条`);
}

/** Deletes everything in the trash for good. */
export async function emptyTrash() {
  const n = await run(Atlas.emptyTrash());
  if (n === undefined) return;
  set({ trash: [], trashCount: 0 });
  toast.success(`回收站已清空，彻底删除了 ${n} 条`);
}

/** A title short enough for a toast. */
function clip(title: string): string {
  return title.length > 24 ? title.slice(0, 24) + "…" : title;
}

/** Copies the items ids, in the queue's order; those under another of them come with it. */
export async function copyItems(ids: number[]) {
  const { items } = get();
  const list = inQueueOrder(items, ids);
  const n = topMost(buildForest(items), list).length;
  if (await runOk(Atlas.copyItems(list))) toast.success(n > 1 ? `已复制 ${n} 条，可以粘贴给 AI 了` : "已复制，可以粘贴给 AI 了");
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
