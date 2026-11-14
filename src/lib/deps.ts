import type { Dep, Item } from "@/mygo";
import { buildForest, isWithin, queueOrder } from "@/lib/tree";

// Prerequisites between items: a Dep has toId wait for fromId. They only
// tell; no status changes because of them (Store.AddDep checks the same
// rules as here).

/** Each item's prerequisites (before) and the items that wait for it (after), in the order of deps. */
export interface DepIndex {
  before: Map<number, number[]>;
  after: Map<number, number[]>;
}

function push(map: Map<number, number[]>, key: number, value: number) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function depIndex(deps: readonly Pick<Dep, "fromId" | "toId">[]): DepIndex {
  const before = new Map<number, number[]>();
  const after = new Map<number, number[]>();
  for (const d of deps) {
    push(before, d.toId, d.fromId);
    push(after, d.fromId, d.toId);
  }
  return { before, after };
}

/**
 * The prerequisites an item still waits for: those not done, while it is
 * not done itself. Empty when it waits for none.
 */
export function waitingFor(item: Item, byId: ReadonlyMap<number, Item>, index: DepIndex): Item[] {
  if (item.status === "done") return [];
  const out: Item[] = [];
  for (const id of index.before.get(item.id) ?? []) {
    const p = byId.get(id);
    if (p && p.status !== "done") out.push(p);
  }
  return out;
}

/** The items reached from start along next, start among them. */
function reach(next: ReadonlyMap<number, number[]>, start: number): Set<number> {
  const seen = new Set<number>();
  const stack = [start];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return seen;
}

/** Whether toId waiting for fromId would close a loop: whether fromId already waits for toId, directly or not. */
export function wouldLoop(deps: readonly Pick<Dep, "fromId" | "toId">[], fromId: number, toId: number): boolean {
  return fromId === toId || reach(depIndex(deps).after, toId).has(fromId);
}

/** Which way a new prerequisite of an item goes: one it waits for (before), or one that waits for it (after). */
export type DepSide = "before" | "after";

/**
 * Why id cannot get other on side, or "" when it can: they are one item,
 * one sits under the other, it is there already, or it would close a loop.
 */
export function depProblem(items: Item[], deps: readonly Pick<Dep, "fromId" | "toId">[], id: number, other: number, side: DepSide): string {
  const [fromId, toId] = side === "before" ? [other, id] : [id, other];
  if (fromId === toId) return "不能是同一条";
  const forest = buildForest(items);
  if (isWithin(forest, fromId, toId) || isWithin(forest, toId, fromId)) return "是上级或子改进点";
  if (deps.some((d) => d.fromId === fromId && d.toId === toId)) return "已经是了";
  if (wouldLoop(deps, fromId, toId)) return "会形成循环";
  return "";
}

/** The items id may get on side, as depProblem has it, in the queue's order: not done first, then done. */
export function depCandidates(items: Item[], deps: readonly Pick<Dep, "fromId" | "toId">[], id: number, side: DepSide): Item[] {
  const forest = buildForest(items);
  const index = depIndex(deps);
  // Those already on that side, and those that would close a loop: the
  // items waiting for id, directly or not, cannot come before it; those it
  // waits for cannot come after it.
  const taken = new Set((side === "before" ? index.before : index.after).get(id) ?? []);
  const loops = reach(side === "before" ? index.after : index.before, id);
  const list = items.filter(
    (i) => !taken.has(i.id) && !loops.has(i.id) && !isWithin(forest, i.id, id) && !isWithin(forest, id, i.id),
  );
  const at = queueOrder(forest);
  list.sort((a, b) => doneLast(a) - doneLast(b) || (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
  return list;
}

const doneLast = (i: Item) => (i.status === "done" ? 1 : 0);

/** How many prerequisites moving the items moved to another project breaks: those with one end only among them. */
export function brokenByMove(deps: readonly Pick<Dep, "fromId" | "toId">[], moved: ReadonlySet<number>): number {
  return deps.filter((d) => moved.has(d.fromId) !== moved.has(d.toId)).length;
}
