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
  type Project,
  type Settings,
} from "@/mygo";
import { errorMessage, run, runOk } from "@/lib/api";

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
  doneOpen: boolean;
  /** Bumped to move the keyboard to the field that adds items. */
  focusNewItem: number;
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
  doneOpen: false,
  focusNewItem: 0,
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

/** Shows an item in the queue, from the overview: clears filters that hide it. */
export function showItem(item: Item) {
  const s = get();
  const hidden =
    (s.typeFilter !== "all" && s.typeFilter !== item.type) ||
    (s.moduleFilter !== "all" && s.moduleFilter !== item.moduleId);
  set({
    statusFilter: matchesStatus(item, s.statusFilter) ? s.statusFilter : "all",
    view: "queue",
    selectedId: item.id,
    doneOpen: s.doneOpen || item.status === "done",
    ...(hidden ? { typeFilter: "all" as const, moduleFilter: "all" as const } : {}),
  });
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

export function toggleDone(open?: boolean) {
  set((s) => ({ doneOpen: open ?? !s.doneOpen }));
}

export function focusNewItem() {
  set((s) => ({ view: "queue", focusNewItem: s.focusNewItem + 1 }));
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

/** Adds an item to the open project. Throws its error, for the field to show. */
export async function createItem(title: string, type: ItemType, moduleId: number): Promise<Item> {
  const item = await Atlas.createItem({ projectId: get().projectId, moduleId, type, title });
  mergeItem(item);
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

export async function setItemStatus(id: number, status: ItemStatus) {
  await editItem(Atlas.setItemStatus(id, status));
}

/** The status a click on an item's circle gives it: done, or back to do. */
export function toggleItemDone(item: Item) {
  void setItemStatus(item.id, item.status === "done" ? "todo" : "done");
}

/** Starts an item, or puts a doing one back to do. */
export function toggleItemDoing(item: Item) {
  void setItemStatus(item.id, item.status === "doing" ? "todo" : "doing");
}

/** Moves an item to do before or after another, as dragged in the queue. */
export function moveTodoItem(id: number, anchorId: number, after: boolean) {
  set((s) => {
    const todo = s.items.filter((i) => i.status === "todo");
    const moving = todo.find((i) => i.id === id);
    if (!moving) return {};
    const rest = todo.filter((i) => i.id !== id);
    let at = rest.findIndex((i) => i.id === anchorId);
    if (at < 0) return {};
    if (after) at++;
    rest.splice(at, 0, moving);
    return {
      items: [...s.items.filter((i) => i.status === "doing"), ...rest, ...s.items.filter((i) => i.status === "done")],
    };
  });
  void runOk(Atlas.moveTodoItem(id, anchorId, after));
}

export async function moveItemToProject(id: number, projectId: number) {
  const item = await run(Atlas.moveItemToProject(id, projectId));
  if (!item) return;
  const project = get().projects.find((p) => p.id === projectId);
  set((s) => ({ items: s.items.filter((i) => i.id !== id), selectedId: s.selectedId === id ? 0 : s.selectedId }));
  toast.success(`已移到「${project?.name ?? "另一个项目"}」`);
}

export async function deleteItem(id: number) {
  if (await runOk(Atlas.deleteItem(id))) {
    set((s) => ({ items: s.items.filter((i) => i.id !== id), selectedId: s.selectedId === id ? 0 : s.selectedId }));
  }
}

export async function copyItem(id: number) {
  if (await runOk(Atlas.copyItem(id))) toast.success("已复制，可以粘贴给 AI 了");
}

export function openDeeplink(id: number) {
  void runOk(Atlas.openDeeplink(id));
}

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
