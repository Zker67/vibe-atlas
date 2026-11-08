import type { Item, ItemStatus, Place } from "@/mygo";

/** An item with the items under it, in their order. */
export interface TreeNode {
  item: Item;
  parent: TreeNode | null;
  children: TreeNode[];
}

/** A project's items as trees: the top-level items, in their order. */
export interface Forest {
  roots: TreeNode[];
  byId: Map<number, TreeNode>;
}

const bySortOrder = (a: TreeNode, b: TreeNode) => a.item.sortOrder - b.item.sortOrder || a.item.id - b.item.id;

/** Builds the trees of a project's items. An item whose parent is missing is top-level. */
export function buildForest(items: Item[]): Forest {
  const byId = new Map<number, TreeNode>();
  for (const item of items) byId.set(item.id, { item, parent: null, children: [] });
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.item.parentId ? byId.get(node.item.parentId) : undefined;
    if (parent && !reaches(parent, node)) {
      node.parent = parent;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  roots.sort(bySortOrder);
  for (const node of byId.values()) if (node.children.length > 1) node.children.sort(bySortOrder);
  return { roots, byId };
}

/** Whether walking up from node, through the parents linked so far, reaches target. */
function reaches(node: TreeNode, target: TreeNode): boolean {
  for (let n: TreeNode | null = node; n; n = n.parent) if (n === target) return true;
  return false;
}

/** The items above id, the top-level one first. */
export function ancestors(forest: Forest, id: number): Item[] {
  const out: Item[] = [];
  for (let n = forest.byId.get(id)?.parent; n; n = n.parent) out.unshift(n.item);
  return out;
}

/** Whether id is root or sits under it. */
export function isWithin(forest: Forest, id: number, root: number): boolean {
  for (let n: TreeNode | null | undefined = forest.byId.get(id); n; n = n.parent) if (n.item.id === root) return true;
  return false;
}

/** The ids of root and of every item under it. */
export function subtreeIds(forest: Forest, root: number): Set<number> {
  const out = new Set<number>();
  const walk = (n: TreeNode) => {
    out.add(n.item.id);
    n.children.forEach(walk);
  };
  const node = forest.byId.get(root);
  if (node) walk(node);
  return out;
}

/** How many items sit under node, and how many of them are done. */
export function progress(node: TreeNode): { done: number; total: number } {
  let done = 0;
  let total = 0;
  const walk = (n: TreeNode) => {
    for (const c of n.children) {
      total++;
      if (c.item.status === "done") done++;
      walk(c);
    }
  };
  walk(node);
  return { done, total };
}

// ---- The queue's rows ----

/** One row of the queue. */
export interface Row {
  item: Item;
  /** 0 for a top-level item. */
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  /** How many items sit under it, and how many of them are done. */
  done: number;
  total: number;
  /** The item does not match the filters: it shows only above those under it that do. */
  context: boolean;
}

/** A top-level item with what shows under it. */
export interface TreeRows {
  root: Item;
  rows: Row[];
  /** How many items of the tree match the filters, collapsed or not. */
  matched: number;
}

export type QueueTrees = Record<ItemStatus, TreeRows[]>;

interface Scan {
  /** It or something under it matches. */
  shown: boolean;
  /** How many of it and what is under it match. */
  matched: number;
  doing: boolean;
  todo: boolean;
  /** The earliest start among the matching items doing. */
  started: number;
  /** The latest completion among the matching items done. */
  doneAt: number;
  /** How many items sit under it, filters aside, and how many of them are done. */
  total: number;
  done: number;
}

/**
 * Lays out the queue. Each tree goes to one section, by the items in it that
 * match: 进行中 when one is doing, else 待办 when one is to do, else 已完成.
 * An item shows when it or something under it matches; children show in
 * their order unless their parent is collapsed. Trees doing are in the
 * order they started, to do in the user's order, done the latest first.
 */
export function queueTrees(forest: Forest, matches: (item: Item) => boolean, collapsed: ReadonlySet<number>): QueueTrees {
  const scans = new Map<number, Scan>();
  const scan = (n: TreeNode): Scan => {
    const it = n.item;
    const m = matches(it);
    const s: Scan = {
      shown: m,
      matched: m ? 1 : 0,
      doing: m && it.status === "doing",
      todo: m && it.status === "todo",
      started: m && it.status === "doing" ? it.startedAt : Infinity,
      doneAt: m && it.status === "done" ? it.doneAt : 0,
      total: 0,
      done: 0,
    };
    for (const c of n.children) {
      const cs = scan(c);
      s.total += 1 + cs.total;
      s.done += (c.item.status === "done" ? 1 : 0) + cs.done;
      if (!cs.shown) continue;
      s.shown = true;
      s.matched += cs.matched;
      s.doing ||= cs.doing;
      s.todo ||= cs.todo;
      s.started = Math.min(s.started, cs.started);
      s.doneAt = Math.max(s.doneAt, cs.doneAt);
    }
    scans.set(it.id, s);
    return s;
  };

  const out: QueueTrees = { doing: [], todo: [], done: [] };
  for (const root of forest.roots) {
    const s = scan(root);
    if (!s.shown) continue;
    const rows: Row[] = [];
    const walk = (n: TreeNode, depth: number) => {
      const isCollapsed = n.children.length > 0 && collapsed.has(n.item.id);
      const sc = scans.get(n.item.id)!;
      rows.push({
        item: n.item,
        depth,
        hasChildren: n.children.length > 0,
        collapsed: isCollapsed,
        done: sc.done,
        total: sc.total,
        context: !matches(n.item),
      });
      if (isCollapsed) return;
      for (const c of n.children) if (scans.get(c.item.id)?.shown) walk(c, depth + 1);
    };
    walk(root, 0);
    out[s.doing ? "doing" : s.todo ? "todo" : "done"].push({ root: root.item, rows, matched: s.matched });
  }
  const started = (t: TreeRows) => scans.get(t.root.id)!.started;
  const doneAt = (t: TreeRows) => scans.get(t.root.id)!.doneAt;
  out.doing.sort((a, b) => started(a) - started(b) || a.root.id - b.root.id);
  out.done.sort((a, b) => doneAt(b) - doneAt(a) || a.root.id - b.root.id);
  return out;
}

// ---- Moving ----

/**
 * What the items become once id moved before or after anchorId, or inside
 * it as its last child, as Store.MoveItem does it; null when the move is
 * not possible.
 */
export function applyMove(items: Item[], id: number, anchorId: number, place: Place): Item[] | null {
  const forest = buildForest(items);
  const moving = forest.byId.get(id);
  const anchor = forest.byId.get(anchorId);
  if (!moving || !anchor || isWithin(forest, anchorId, id)) return null;
  const parent = place === "inside" ? anchor : anchor.parent;
  const siblings = (parent ? parent.children : forest.roots).map((n) => n.item.id).filter((v) => v !== id);
  let at = siblings.length;
  if (place !== "inside") {
    at = siblings.indexOf(anchorId);
    if (place === "after") at++;
  }
  siblings.splice(at, 0, id);
  const order = new Map(siblings.map((v, i) => [v, i + 1]));
  const parentId = parent?.item.id ?? 0;
  return items.map((it) => {
    const sortOrder = order.get(it.id);
    if (sortOrder === undefined) return it;
    return { ...it, sortOrder, parentId: it.id === id ? parentId : it.parentId };
  });
}

// ---- Links ----

/**
 * The item whose link id opens: itself when it has one; else, when links
 * are shared, the nearest item above it that has one; null for none.
 */
export function linkSource(byId: ReadonlyMap<number, Item>, id: number, shared: boolean): Item | null {
  const seen = new Set<number>();
  for (let it = byId.get(id); it && !seen.has(it.id); it = shared ? byId.get(it.parentId) : undefined) {
    if (it.deeplink) return it;
    seen.add(it.id);
  }
  return null;
}
