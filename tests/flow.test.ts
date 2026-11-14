// The flow chart's pure parts (src/lib/flow): the viewport, the curves, the
// cards an item and the items under it make, their layout, lining up a
// dragged card, where a line being drawn lands, and the undo history. The board itself, with the
// pointer, is checked by hand in a real window.

import { expect, test } from "bun:test";
import {
  boundsOf,
  curveMiddle,
  curvePath,
  fitView,
  MAX_ZOOM,
  MIN_ZOOM,
  nearestPort,
  overlaps,
  rectBetween,
  revealView,
  snapToGuides,
  toChart,
  toScreen,
  wheelZoom,
  zoomAt,
} from "../src/lib/flow/geometry";
import {
  cardEdges,
  cardHeight,
  cardsOf,
  COLUMN_GAP,
  columnsOf,
  DRAFT_HEIGHT,
  draftSpot,
  groupsOf,
  headHeight,
  NODE_HEIGHT,
  NODE_WIDTH,
  placesOf,
  ROW_GAP,
  ROW_HEIGHT,
  rowMiddle,
  tidyPlaces,
} from "../src/lib/flow/layout";
import { EMPTY_HISTORY, HISTORY_LIMIT, inverse, lastAt, record, redoStep, stepLabel, undoStep, type FlowStep } from "../src/lib/flow/history";

test("the viewport turns points between the screen and the chart", () => {
  const v = { x: 100, y: -50, zoom: 2 };
  expect(toChart(v, { x: 300, y: 150 })).toEqual({ x: 100, y: 100 });
  expect(toScreen(v, { x: 100, y: 100 })).toEqual({ x: 300, y: 150 });
});

test("zooming keeps the point under the pointer in place, within bounds", () => {
  const v = { x: 10, y: 20, zoom: 1 };
  const at = { x: 400, y: 300 };
  const z = zoomAt(v, 1.5, at);
  expect(toChart(z, at)).toEqual(toChart(v, at));
  expect(zoomAt(v, 99, at).zoom).toBe(MAX_ZOOM);
  expect(zoomAt(v, 0, at).zoom).toBe(MIN_ZOOM);
  // A notch of the wheel down zooms out, up zooms in.
  expect(wheelZoom(1, 100, 0, false)).toBeLessThan(1);
  expect(wheelZoom(1, -100, 0, false)).toBeGreaterThan(1);
  // Lines count as 16 pixels.
  expect(wheelZoom(1, 3, 1, false)).toBeCloseTo(wheelZoom(1, 48, 0, false));
});

test("fitView shows everything, centered, no closer than 100 %", () => {
  const b = { x: 0, y: 0, width: 1000, height: 500 };
  const v = fitView(b, 548, 348, 24);
  expect(v.zoom).toBeCloseTo(0.5);
  expect(toScreen(v, { x: 500, y: 250 })).toEqual({ x: 274, y: 174 });
  expect(fitView({ x: 0, y: 0, width: 10, height: 10 }, 1000, 1000).zoom).toBe(1);
  expect(fitView(null, 800, 600)).toEqual({ x: 48, y: 48, zoom: 1 });
});

test("rectangles: bounds, corners in any order, overlap", () => {
  expect(boundsOf([])).toBeNull();
  expect(
    boundsOf([
      { x: 0, y: 10, width: 5, height: 5 },
      { x: -5, y: 0, width: 2, height: 2 },
    ]),
  ).toEqual({ x: -5, y: 0, width: 10, height: 15 });
  expect(rectBetween({ x: 10, y: 0 }, { x: 0, y: 5 })).toEqual({ x: 0, y: 0, width: 10, height: 5 });
  expect(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 10, width: 1, height: 1 })).toBe(true);
  expect(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 0, width: 1, height: 1 })).toBe(false);
});

test("a line is a curve from its start to its end, its middle between them", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 200, y: 100 };
  expect(curvePath(a, b)).toStartWith("M 0 0 C ");
  expect(curvePath(a, b)).toEndWith(", 200 100");
  expect(curveMiddle(a, b)).toEqual({ x: 100, y: 50 });
});

test("columnsOf puts each card one past the furthest it waits for", () => {
  const cols = columnsOf([1, 2, 3, 4, 5], [
    { fromId: 1, toId: 2 },
    { fromId: 2, toId: 3 },
    { fromId: 1, toId: 3 },
    { fromId: 4, toId: 3 },
  ]);
  expect([...cols]).toEqual([
    [1, 0],
    [4, 0],
    [5, 0],
    [2, 1],
    [3, 2],
  ]);
  // A loop (Go refuses those) does not hang: its cards go to the first column.
  expect(columnsOf([1, 2], [
    { fromId: 1, toId: 2 },
    { fromId: 2, toId: 1 },
  ]).get(1)).toBe(0);
});

test("groupsOf splits the cards joined by lines", () => {
  expect(groupsOf([1, 2, 3, 4, 5], [
    { fromId: 1, toId: 3 },
    { fromId: 4, toId: 5 },
  ])).toEqual([[1, 3], [2], [4, 5]]);
});

test("tidyPlaces: prerequisites on the left, cards without lines in rows under", () => {
  const p = tidyPlaces([1, 2, 3, 9], [
    { fromId: 1, toId: 2 },
    { fromId: 1, toId: 3 },
  ], { x: 0, y: 0 });
  const step = NODE_WIDTH + COLUMN_GAP;
  expect(p.get(1)!.x).toBe(0);
  expect(p.get(2)!.x).toBe(step);
  expect(p.get(3)!.x).toBe(step);
  // 2 and 3 stack in their column; 1 sits in the middle of them.
  expect(p.get(3)!.y - p.get(2)!.y).toBe(NODE_HEIGHT + ROW_GAP);
  expect(p.get(1)!.y).toBe((NODE_HEIGHT + ROW_GAP) / 2);
  // 9 has no line: under the group.
  expect(p.get(9)!.y).toBeGreaterThanOrEqual(p.get(3)!.y + NODE_HEIGHT);
  expect(p.get(9)!.x).toBe(0);
});

test("tidyPlaces orders a column to cross fewer lines", () => {
  // 1 → 4 and 2 → 3: with 3 and 4 in their order, the lines would cross.
  const p = tidyPlaces([1, 2, 3, 4], [
    { fromId: 1, toId: 4 },
    { fromId: 2, toId: 3 },
  ], { x: 0, y: 0 });
  // Two groups, each a row of its own: 1 beside 4, 2 beside 3.
  expect(p.get(1)!.y).toBe(p.get(4)!.y);
  expect(p.get(2)!.y).toBe(p.get(3)!.y);

  const q = tidyPlaces([1, 2, 3, 4, 5], [
    { fromId: 1, toId: 4 },
    { fromId: 2, toId: 3 },
    { fromId: 5, toId: 3 },
    { fromId: 5, toId: 4 },
  ], { x: 0, y: 0 });
  // One group: 3 comes before 4 only if 2 comes before 1, and so on — no line crosses.
  const above = (a: number, b: number) => q.get(a)!.y < q.get(b)!.y;
  expect(above(1, 2) === above(4, 3)).toBe(true);
});

test("placesOf keeps the saved places and lays out the others under them", () => {
  const saved = new Map([[1, { x: 40, y: 80 }]]);
  const p = placesOf([1, 2, 3], saved, []);
  expect(p.get(1)).toEqual({ x: 40, y: 80 });
  expect(p.get(2)!.y).toBeGreaterThanOrEqual(80 + NODE_HEIGHT);
  expect(p.get(2)!.x).toBe(40);
  expect(p.get(3)!.y).toBe(p.get(2)!.y);
  // None saved: from the chart's origin.
  expect(placesOf([7], new Map(), []).get(7)).toEqual({ x: 0, y: 0 });
});

test("the history undoes and redoes, and forgets what failed", () => {
  const move: FlowStep = { kind: "place", before: [{ itemId: 1, x: 0, y: 0 }], after: [{ itemId: 1, x: 8, y: 8 }] };
  const line: FlowStep = { kind: "link", fromId: 1, toId: 2 };
  let h = record(record(EMPTY_HISTORY, move, 10), line, 20);
  expect(lastAt(h)).toBe(20);

  const u = undoStep(h)!;
  expect(u.run).toEqual({ kind: "unlink", fromId: 1, toId: 2 });
  h = u.done;
  expect(lastAt(h)).toBe(10);
  const r = redoStep(h)!;
  expect(r.run).toEqual(line);

  // The move undone fails (the card is gone): it is dropped, nothing to redo.
  const u2 = undoStep(h)!;
  expect(u2.run).toEqual(inverse(move));
  h = u2.failed;
  expect(h.past).toEqual([]);
  expect(h.future.map((e) => e.step)).toEqual([line]);
  expect(undoStep(h)).toBeNull();

  // A new step forgets what was undone.
  h = record(h, move, 30);
  expect(h.future).toEqual([]);
  expect(redoStep(h)).toBeNull();

  // It keeps the last HISTORY_LIMIT steps.
  let long = EMPTY_HISTORY;
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) long = record(long, line, i);
  expect(long.past.length).toBe(HISTORY_LIMIT);
  expect(long.past[0]!.at).toBe(5);
});

test("a line back into its own card leaves and comes in on the right", () => {
  const a = { x: 224, y: 36 };
  const b = { x: 224, y: 120 };
  const d = curvePath(a, b, true);
  // Both handles to the right of the card's side.
  const [c1x, , c2x] = d.split(" C ")[1]!.split(/[ ,]+/).map(Number);
  expect(d.startsWith("M 224 36 C ")).toBe(true);
  expect(c1x).toBeGreaterThan(224);
  expect(c2x).toBeGreaterThan(224);
  const m = curveMiddle(a, b, true);
  expect(m.x).toBeGreaterThan(224);
  expect(m.y).toBe(78);
});

test("cardsOf puts the items under an item on its card, as deep as they sit among those shown", () => {
  // 1 > 2 > 3, 1 > 4; 5 > 6 with 5 hidden; 7 > 8 > 9 with 8 hidden.
  const parents = new Map([
    [2, 1],
    [3, 2],
    [4, 1],
    [6, 5],
    [8, 7],
    [9, 8],
  ]);
  const cards = cardsOf([1, 2, 3, 4, 6, 7, 9], (id) => parents.get(id) ?? 0);
  expect(cards.roots).toEqual([1, 6, 7]);
  expect(cards.rows.get(1)).toEqual([
    { id: 2, depth: 1 },
    { id: 3, depth: 2 },
    { id: 4, depth: 1 },
  ]);
  // Its parent hidden, 6 heads its own card; 9 sits right under 7, 8 hidden between.
  expect(cards.rows.get(6)).toBeUndefined();
  expect(cards.rows.get(7)).toEqual([{ id: 9, depth: 1 }]);
  expect([...cards.rootOf]).toEqual([
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
    [6, 6],
    [7, 7],
    [9, 7],
  ]);
  expect(cards.index.get(1)).toBe(-1);
  expect(cards.index.get(3)).toBe(1);
  expect(cards.index.get(4)).toBe(2);
});

test("cardsOf survives a loop of parents", () => {
  const parents = new Map([
    [1, 2],
    [2, 1],
  ]);
  const cards = cardsOf([1, 2], (id) => parents.get(id) ?? 0);
  expect(cards.roots.length).toBe(1);
  expect(cards.rootOf.get(1)).toBe(cards.rootOf.get(2));
});

test("cardEdges joins the cards whose items wait for each other, once, not a card to itself", () => {
  const rootOf = new Map([
    [1, 1],
    [2, 1],
    [3, 3],
    [4, 3],
  ]);
  const edges = [
    { fromId: 2, toId: 4 },
    { fromId: 1, toId: 3 },
    { fromId: 1, toId: 2 },
    { fromId: 9, toId: 3 },
  ];
  expect(cardEdges(edges, rootOf)).toEqual([{ fromId: 1, toId: 3 }]);
});

test("a card grows a row at a time, its handles in the middle of each", () => {
  expect(cardHeight(0)).toBe(NODE_HEIGHT);
  expect(cardHeight(2) - cardHeight(1)).toBe(ROW_HEIGHT);
  expect(rowMiddle(-1)).toBe(NODE_HEIGHT / 2);
  expect(rowMiddle(1) - rowMiddle(0)).toBe(ROW_HEIGHT);
  // As much room above the first row as under the last.
  expect(rowMiddle(0) - ROW_HEIGHT / 2 - NODE_HEIGHT).toBe(cardHeight(3) - (rowMiddle(2) + ROW_HEIGHT / 2));
});

test("tidyPlaces stacks cards of any height without covering, on the grid", () => {
  const tall = cardHeight(3);
  const heightOf = (id: number) => (id === 1 || id === 5 ? tall : NODE_HEIGHT);
  // 1 and 2 both wait for nothing, 3 waits for both; 4, 5, 6 have no lines.
  const edges = [
    { fromId: 1, toId: 3 },
    { fromId: 2, toId: 3 },
  ];
  const places = tidyPlaces([1, 2, 3, 4, 5, 6], edges, { x: 0, y: 0 }, heightOf);
  const rect = (id: number) => ({ ...places.get(id)!, width: NODE_WIDTH, height: heightOf(id) });
  const ids = [1, 2, 3, 4, 5, 6];
  for (const a of ids) {
    expect(places.get(a)!.y % 8).toBe(0);
    for (const b of ids) if (a < b) expect(overlaps(rect(a), rect(b))).toBe(false);
  }
  expect(places.get(2)!.y).toBeGreaterThanOrEqual(places.get(1)!.y + tall + ROW_GAP);
  // The loose ones in a row under, as tall as the tallest of them.
  expect(places.get(4)!.y).toBe(places.get(5)!.y);
  expect(places.get(4)!.y).toBeGreaterThanOrEqual(places.get(2)!.y + NODE_HEIGHT + ROW_GAP);
});

test("placesOf lays the unsaved out under the bottom of the tallest saved card", () => {
  const tall = cardHeight(4);
  const places = placesOf([1, 2], new Map([[1, { x: 0, y: 0 }]]), [], (id) => (id === 1 ? tall : NODE_HEIGHT));
  expect(places.get(2)!.y).toBeGreaterThanOrEqual(tall + ROW_GAP);
});

test("snapToGuides lines a card up with another near it, else snaps to the grid", () => {
  const other = { x: 0, y: 0, width: 224, height: 72 };
  // Its left 4 off the other's left, its top far: the left lines up, the top snaps.
  expect(snapToGuides({ x: 4, y: 203, width: 224, height: 100 }, [other], 6, 8)).toEqual({ x: 0, y: 200, guideX: 0, guideY: null });
  // Its middle 3 off the other's middle.
  const m = snapToGuides({ x: 300, y: -11, width: 224, height: 100 }, [other], 6, 8);
  expect(m.y).toBe(-14);
  expect(m.guideY).toBe(36);
  // Its left 2 off the other's right: that one, the nearest.
  const n = snapToGuides({ x: 222, y: 500, width: 224, height: 72 }, [other], 6, 8);
  expect(n.x).toBe(224);
  expect(n.guideX).toBe(224);
});

test("nearestPort: over a card its nearest row, able or not; else the nearest able one within reach", () => {
  const card = { x: 0, y: 0, width: 224, height: 140 };
  const ports = [
    { id: 1, card, at: { x: 0, y: 36 }, ok: true },
    { id: 2, card, at: { x: 0, y: 90 }, ok: false },
    { id: 3, card: { x: 400, y: 0, width: 224, height: 72 }, at: { x: 400, y: 36 }, ok: true },
    { id: 4, card: { x: 400, y: 100, width: 224, height: 72 }, at: { x: 400, y: 136 }, ok: false },
  ];
  expect(nearestPort(ports, { x: 100, y: 80 }, 28)?.id).toBe(2);
  expect(nearestPort(ports, { x: 100, y: 50 }, 28)?.id).toBe(1);
  // Outside the cards: the able one within reach.
  expect(nearestPort(ports, { x: 380, y: 40 }, 28)?.id).toBe(3);
  // The unable one near is passed over; nothing else is in reach.
  expect(nearestPort(ports, { x: 380, y: 136 }, 28)).toBeNull();
  expect(nearestPort(ports, { x: 300, y: 300 }, 28)).toBeNull();
});

test("a step of the history says what it is, a tidy as one", () => {
  const tidy: FlowStep = { kind: "place", before: [], after: [], label: "一键整理" };
  expect(stepLabel(tidy)).toBe("一键整理");
  expect(stepLabel(inverse(tidy))).toBe("一键整理");
  expect(stepLabel({ kind: "place", before: [], after: [] })).toBe("移动");
  expect(stepLabel({ kind: "link", fromId: 1, toId: 2 })).toBe("连线");
  expect(stepLabel({ kind: "unlink", fromId: 1, toId: 2 })).toBe("删除连线");
});

test("revealView leaves what shows, moves just enough, zooms out only when too large", () => {
  const v = { x: 0, y: 0, zoom: 1 };
  expect(revealView(v, { x: 100, y: 100, width: 200, height: 80 }, 800, 600)).toBe(v);
  // Over the right edge: moved left until 32 in.
  expect(revealView(v, { x: 700, y: 100, width: 200, height: 80 }, 800, 600)).toEqual({ x: -132, y: 0, zoom: 1 });
  // Above the top: moved down.
  expect(revealView(v, { x: 100, y: -50, width: 200, height: 80 }, 800, 600)).toEqual({ x: 0, y: 82, zoom: 1 });
  // Wider than the canvas: zoomed out to fit, all of it in.
  const z = revealView(v, { x: 0, y: 0, width: 1600, height: 80 }, 800, 600);
  expect(z.zoom).toBeLessThan(1);
  expect(z.x).toBeGreaterThanOrEqual(31);
  expect(z.x + 1600 * z.zoom).toBeLessThanOrEqual(800 - 31);
});

test("draftSpot puts a new card drawn from an item in the next column, on its row, past the cards there", () => {
  const card = { x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT };
  const from = { card, y: NODE_HEIGHT / 2, side: "out" as const };
  // Dropped a little off: to the next column, on the row.
  expect(draftSpot({ x: NODE_WIDTH + 50, y: 30 }, [card], 12, from)).toEqual({ x: NODE_WIDTH + COLUMN_GAP, y: 0 });
  // From the left side: the column before.
  expect(draftSpot({ x: -300, y: 10 }, [card], 12, { ...from, side: "in" }).x).toBe(-COLUMN_GAP - NODE_WIDTH);
  // Far away: where dropped, on the grid.
  expect(draftSpot({ x: 1001, y: 499 }, [card], 12, from)).toEqual({ x: 1000, y: 496 });
  // A card already in that spot: just under it.
  const there = { x: NODE_WIDTH + COLUMN_GAP, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT };
  const spot = draftSpot({ x: NODE_WIDTH + 60, y: 0 }, [card, there], 12, from);
  expect(spot.x).toBe(NODE_WIDTH + COLUMN_GAP);
  expect(spot.y).toBeGreaterThanOrEqual(NODE_HEIGHT + ROW_GAP);
  expect(overlaps({ ...spot, width: NODE_WIDTH, height: DRAFT_HEIGHT }, there)).toBe(false);
});

test("a long title makes the head a line taller, the rows and handles moving down with it", () => {
  expect(headHeight(1)).toBe(NODE_HEIGHT);
  expect(headHeight(2)).toBe(NODE_HEIGHT);
  expect(headHeight(3)).toBe(NODE_HEIGHT + 20);
  expect(headHeight(9)).toBe(headHeight(3));
  const head = headHeight(3);
  expect(cardHeight(0, head)).toBe(head);
  expect(cardHeight(2, head) - cardHeight(2)).toBe(20);
  expect(rowMiddle(-1, head)).toBe(head / 2);
  expect(rowMiddle(0, head) - rowMiddle(0)).toBe(20);
});
