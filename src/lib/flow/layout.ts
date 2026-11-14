import { snap, type Point } from "./geometry";

// Laying out the flow chart: the cards of items with prerequisites in
// columns, those done first on the left; the others in rows under them.
// Pure, for the tests. Every card has the same size.

/** The size of a card on the chart. */
export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 72;
/** The chart's dot grid: cards snap to it. */
export const GRID = 8;
/** Between the columns, and between the cards of a column. */
export const COLUMN_GAP = 88;
export const ROW_GAP = 24;

/** A line of the chart: to waits for from. */
export interface Edge {
  fromId: number;
  toId: number;
}

/** The edges between ids only, without loops onto one card. */
function edgesAmong(ids: ReadonlySet<number>, edges: readonly Edge[]): Edge[] {
  return edges.filter((e) => e.fromId !== e.toId && ids.has(e.fromId) && ids.has(e.toId));
}

/**
 * The column of each id: 0 for those that wait for none, else one past the
 * furthest of those they wait for. Ids in a loop (Go refuses those) go to 0.
 */
export function columnsOf(ids: readonly number[], edges: readonly Edge[]): Map<number, number> {
  const among = edgesAmong(new Set(ids), edges);
  const incoming = new Map<number, number>();
  const next = new Map<number, number[]>();
  for (const e of among) {
    incoming.set(e.toId, (incoming.get(e.toId) ?? 0) + 1);
    next.set(e.fromId, [...(next.get(e.fromId) ?? []), e.toId]);
  }
  const column = new Map<number, number>();
  const queue = ids.filter((id) => !incoming.has(id));
  for (const id of queue) column.set(id, 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const to of next.get(id) ?? []) {
      column.set(to, Math.max(column.get(to) ?? 0, (column.get(id) ?? 0) + 1));
      const left = (incoming.get(to) ?? 1) - 1;
      incoming.set(to, left);
      if (left === 0) queue.push(to);
    }
  }
  for (const id of ids) if (!column.has(id)) column.set(id, 0);
  return column;
}

/** The groups of ids joined by lines, each in the order of ids, the groups by their first. */
export function groupsOf(ids: readonly number[], edges: readonly Edge[]): number[][] {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: number): number => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const e of edgesAmong(new Set(ids), edges)) parent.set(find(e.fromId), find(e.toId));
  const groups = new Map<number, number[]>();
  for (const id of ids) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }
  return [...groups.values()];
}

/**
 * One group joined by lines, laid out from origin: a column per
 * columnsOf, the cards of each ordered to cross as few lines as a few
 * sweeps of averages find (the order of ids breaks ties). Returns the
 * places and the height it takes.
 */
function layOutGroup(ids: readonly number[], edges: readonly Edge[], origin: Point): { places: Map<number, Point>; width: number; height: number } {
  const column = columnsOf(ids, edges);
  const among = edgesAmong(new Set(ids), edges);
  const count = Math.max(...column.values()) + 1;
  const cols: number[][] = Array.from({ length: count }, () => []);
  for (const id of ids) cols[column.get(id)!]!.push(id);
  const before = new Map<number, number[]>();
  const after = new Map<number, number[]>();
  for (const e of among) {
    before.set(e.toId, [...(before.get(e.toId) ?? []), e.fromId]);
    after.set(e.fromId, [...(after.get(e.fromId) ?? []), e.toId]);
  }
  const rank = new Map<number, number>();
  const setRanks = (col: number[]) => col.forEach((id, i) => rank.set(id, i));
  cols.forEach(setRanks);
  const sortBy = (col: number[], near: Map<number, number[]>) => {
    const key = new Map(
      col.map((id) => {
        const ns = (near.get(id) ?? []).filter((n) => rank.has(n));
        return [id, ns.length ? ns.reduce((sum, n) => sum + rank.get(n)!, 0) / ns.length : rank.get(id)!];
      }),
    );
    col.sort((a, b) => key.get(a)! - key.get(b)! || rank.get(a)! - rank.get(b)!);
    setRanks(col);
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let c = 1; c < count; c++) sortBy(cols[c]!, before);
    for (let c = count - 2; c >= 0; c--) sortBy(cols[c]!, after);
  }
  const tallest = Math.max(...cols.map((col) => col.length));
  const height = tallest * NODE_HEIGHT + (tallest - 1) * ROW_GAP;
  const places = new Map<number, Point>();
  cols.forEach((col, c) => {
    const own = col.length * NODE_HEIGHT + (col.length - 1) * ROW_GAP;
    // Shorter columns sit in the middle of the tallest.
    const top = origin.y + snap((height - own) / 2, GRID);
    col.forEach((id, i) => {
      places.set(id, { x: origin.x + c * (NODE_WIDTH + COLUMN_GAP), y: top + i * (NODE_HEIGHT + ROW_GAP) });
    });
  });
  return { places, width: count * NODE_WIDTH + (count - 1) * COLUMN_GAP, height };
}

/**
 * Where tidying puts the cards ids, from origin: the groups joined by
 * lines one under the other, then those without lines in rows under them,
 * at least four a row and as wide as the groups. The order of ids comes
 * first among equals.
 */
export function tidyPlaces(ids: readonly number[], edges: readonly Edge[], origin: Point): Map<number, Point> {
  const places = new Map<number, Point>();
  const set = new Set(ids);
  const linked = new Set(edgesAmong(set, edges).flatMap((e) => [e.fromId, e.toId]));
  let y = origin.y;
  let width = 0;
  for (const group of groupsOf(
    ids.filter((id) => linked.has(id)),
    edges,
  )) {
    const laid = layOutGroup(group, edges, { x: origin.x, y });
    for (const [id, p] of laid.places) places.set(id, p);
    y += laid.height + ROW_GAP * 2;
    width = Math.max(width, laid.width);
  }
  const loose = ids.filter((id) => !linked.has(id));
  const perRow = Math.max(4, Math.floor((width + COLUMN_GAP / 2) / (NODE_WIDTH + COLUMN_GAP / 2)));
  loose.forEach((id, i) => {
    places.set(id, {
      x: origin.x + (i % perRow) * (NODE_WIDTH + COLUMN_GAP / 2),
      y: y + Math.floor(i / perRow) * (NODE_HEIGHT + ROW_GAP),
    });
  });
  return places;
}

/**
 * Where the cards ids show: those saved where they were saved; the others
 * as tidyPlaces lays them out, from the chart's origin when none is saved,
 * else under the saved ones, so that none covers another.
 */
export function placesOf(ids: readonly number[], saved: ReadonlyMap<number, Point>, edges: readonly Edge[]): Map<number, Point> {
  const places = new Map<number, Point>();
  const unsaved: number[] = [];
  let left = Infinity;
  let bottom = -Infinity;
  for (const id of ids) {
    const p = saved.get(id);
    if (p) {
      places.set(id, p);
      left = Math.min(left, p.x);
      bottom = Math.max(bottom, p.y + NODE_HEIGHT);
    } else {
      unsaved.push(id);
    }
  }
  if (unsaved.length === 0) return places;
  const origin = places.size ? { x: snap(left, GRID), y: snap(bottom + ROW_GAP * 3, GRID) } : { x: 0, y: 0 };
  for (const [id, p] of tidyPlaces(unsaved, edges, origin)) places.set(id, p);
  return places;
}
