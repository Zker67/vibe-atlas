// The flow chart's pure parts (src/lib/flow): the viewport, the curves, the
// layout of the cards, and the undo history. The board itself, with the
// pointer, is checked by hand in a real window.

import { expect, test } from "bun:test";
import {
  boundsOf,
  curveMiddle,
  curvePath,
  fitView,
  MAX_ZOOM,
  MIN_ZOOM,
  overlaps,
  rectBetween,
  toChart,
  toScreen,
  wheelZoom,
  zoomAt,
} from "../src/lib/flow/geometry";
import { COLUMN_GAP, columnsOf, groupsOf, NODE_HEIGHT, NODE_WIDTH, placesOf, ROW_GAP, tidyPlaces } from "../src/lib/flow/layout";
import { EMPTY_HISTORY, HISTORY_LIMIT, inverse, lastAt, record, redoStep, undoStep, type FlowStep } from "../src/lib/flow/history";

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
