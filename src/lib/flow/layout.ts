import { snap, type Point } from "./geometry";

// Laying out the flow chart: an item with the items under it is one card,
// its head and a row for each of them; the cards with prerequisites in
// columns, those done first on the left; the others in rows under them.
// Pure, for the tests. Every card is as wide; heights grow with the rows.

/** The size of a card on the chart: its head, the whole card when it has no rows. */
export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 72;
/** A row under a card's head, and the room above the first and under the last. */
export const ROW_HEIGHT = 28;
export const ROWS_PAD = 4;
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

/** How tall a card is: its head, and its rows under. */
export function cardHeight(rows: number): number {
  return rows > 0 ? NODE_HEIGHT + ROWS_PAD * 2 + rows * ROW_HEIGHT : NODE_HEIGHT;
}

/** How far down a card the middle of its row index is, where its handles are: -1 for its head. */
export function rowMiddle(index: number): number {
  return index < 0 ? NODE_HEIGHT / 2 : NODE_HEIGHT + ROWS_PAD + index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

const fixedHeight = () => NODE_HEIGHT;

/** v, up to the next step of the grid: stacked cards of any height stay on it. */
const upToGrid = (v: number) => Math.ceil(v / GRID) * GRID;

/** A row under a card's head: the item, and how deep it sits (1 right under the head). */
export interface CardRow {
  id: number;
  depth: number;
}

/** The items shown, as cards. */
export interface Cards {
  /** The items heading a card, in the order of ids. */
  roots: number[];
  /** The card each item shows on, by its head: its own id for a head. */
  rootOf: Map<number, number>;
  /** The rows under each card's head, in the order of ids. */
  rows: Map<number, CardRow[]>;
  /** Where each item's row is on its card: -1 for a head. */
  index: Map<number, number>;
}

/**
 * Makes the items ids into cards: an item goes on the card of the nearest
 * item above it that shows (parentOf gives the item an item sits under, 0
 * for none), a row deeper for each shown item between; an item with none
 * above it shown heads its own card. ids should list the items above
 * before those under them, as the queue does.
 */
export function cardsOf(ids: readonly number[], parentOf: (id: number) => number): Cards {
  const shown = new Set(ids);
  // The nearest shown item above each, or 0.
  const up = new Map<number, number>();
  for (const id of ids) {
    const seen = new Set([id]);
    let p = parentOf(id);
    while (p && !shown.has(p) && !seen.has(p)) {
      seen.add(p);
      p = parentOf(p);
    }
    up.set(id, p && shown.has(p) && !seen.has(p) ? p : 0);
  }
  const rootOf = new Map<number, number>();
  const depth = new Map<number, number>();
  for (const id of ids) {
    const chain: number[] = [];
    const onChain = new Set<number>();
    let at = id;
    while (!rootOf.has(at)) {
      const above = up.get(at) ?? 0;
      if (!above || onChain.has(at)) {
        // At the top, or round a loop (Go refuses those): it heads a card.
        rootOf.set(at, at);
        depth.set(at, 0);
        break;
      }
      onChain.add(at);
      chain.push(at);
      at = above;
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = chain[i]!;
      if (rootOf.has(c)) continue;
      const above = up.get(c)!;
      rootOf.set(c, rootOf.get(above)!);
      depth.set(c, depth.get(above)! + 1);
    }
  }
  const roots: number[] = [];
  const rows = new Map<number, CardRow[]>();
  const index = new Map<number, number>();
  for (const id of ids) {
    const root = rootOf.get(id)!;
    if (root === id) {
      roots.push(id);
      index.set(id, -1);
      continue;
    }
    const list = rows.get(root) ?? [];
    index.set(id, list.length);
    list.push({ id, depth: depth.get(id)! });
    rows.set(root, list);
  }
  return { roots, rootOf, rows, index };
}

/** The lines between cards, from those between their items: one for any between two cards, none within one. */
export function cardEdges(edges: readonly Edge[], rootOf: ReadonlyMap<number, number>): Edge[] {
  const seen = new Set<string>();
  const out: Edge[] = [];
  for (const e of edges) {
    const fromId = rootOf.get(e.fromId);
    const toId = rootOf.get(e.toId);
    if (fromId === undefined || toId === undefined || fromId === toId) continue;
    const key = `${fromId}>${toId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ fromId, toId });
  }
  return out;
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
 * places and the room it takes.
 */
function layOutGroup(
  ids: readonly number[],
  edges: readonly Edge[],
  origin: Point,
  heightOf: (id: number) => number,
): { places: Map<number, Point>; width: number; height: number } {
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
  const columnHeight = (col: number[]) => col.reduce((sum, id, i) => (i ? upToGrid(sum + ROW_GAP) : sum) + heightOf(id), 0);
  const height = Math.max(...cols.map(columnHeight));
  const places = new Map<number, Point>();
  cols.forEach((col, c) => {
    // Shorter columns sit in the middle of the tallest.
    let y = origin.y + snap((height - columnHeight(col)) / 2, GRID);
    for (const id of col) {
      places.set(id, { x: origin.x + c * (NODE_WIDTH + COLUMN_GAP), y });
      y = upToGrid(y + heightOf(id) + ROW_GAP);
    }
  });
  return { places, width: count * NODE_WIDTH + (count - 1) * COLUMN_GAP, height };
}

/**
 * Where tidying puts the cards ids, from origin: the groups joined by
 * lines one under the other, then those without lines in rows under them,
 * at least four a row and as wide as the groups. The order of ids comes
 * first among equals; heightOf gives how tall each card is.
 */
export function tidyPlaces(
  ids: readonly number[],
  edges: readonly Edge[],
  origin: Point,
  heightOf: (id: number) => number = fixedHeight,
): Map<number, Point> {
  const places = new Map<number, Point>();
  const set = new Set(ids);
  const linked = new Set(edgesAmong(set, edges).flatMap((e) => [e.fromId, e.toId]));
  let y = origin.y;
  let width = 0;
  for (const group of groupsOf(
    ids.filter((id) => linked.has(id)),
    edges,
  )) {
    const laid = layOutGroup(group, edges, { x: origin.x, y }, heightOf);
    for (const [id, p] of laid.places) places.set(id, p);
    y = upToGrid(y + laid.height + ROW_GAP * 2);
    width = Math.max(width, laid.width);
  }
  const loose = ids.filter((id) => !linked.has(id));
  const perRow = Math.max(4, Math.floor((width + COLUMN_GAP / 2) / (NODE_WIDTH + COLUMN_GAP / 2)));
  for (let start = 0; start < loose.length; start += perRow) {
    const row = loose.slice(start, start + perRow);
    row.forEach((id, i) => places.set(id, { x: origin.x + i * (NODE_WIDTH + COLUMN_GAP / 2), y }));
    // Each row as tall as its tallest card.
    y = upToGrid(y + Math.max(...row.map(heightOf)) + ROW_GAP);
  }
  return places;
}

/**
 * Where the cards ids show: those saved where they were saved; the others
 * as tidyPlaces lays them out, from the chart's origin when none is saved,
 * else under the saved ones, so that none covers another.
 */
export function placesOf(
  ids: readonly number[],
  saved: ReadonlyMap<number, Point>,
  edges: readonly Edge[],
  heightOf: (id: number) => number = fixedHeight,
): Map<number, Point> {
  const places = new Map<number, Point>();
  const unsaved: number[] = [];
  let left = Infinity;
  let bottom = -Infinity;
  for (const id of ids) {
    const p = saved.get(id);
    if (p) {
      places.set(id, p);
      left = Math.min(left, p.x);
      bottom = Math.max(bottom, p.y + heightOf(id));
    } else {
      unsaved.push(id);
    }
  }
  if (unsaved.length === 0) return places;
  const origin = places.size ? { x: snap(left, GRID), y: snap(bottom + ROW_GAP * 3, GRID) } : { x: 0, y: 0 };
  for (const [id, p] of tidyPlaces(unsaved, edges, origin, heightOf)) places.set(id, p);
  return places;
}
