// The geometry of the flow chart: the viewport between the screen and the
// chart, rectangles, and the curves of the lines. Pure, for the tests.

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

/** How the chart shows on the screen: screen = chart × zoom + (x, y), in the canvas's pixels. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Where a point of the canvas (screen pixels from its corner) is on the chart. */
export function toChart(v: Viewport, p: Point): Point {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
}

/** Where a point of the chart shows on the canvas. */
export function toScreen(v: Viewport, p: Point): Point {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
}

/** The viewport zoomed to zoom (clamped), keeping the point of the chart under at, a point of the canvas, in place. */
export function zoomAt(v: Viewport, zoom: number, at: Point): Viewport {
  const z = clampZoom(zoom);
  const p = toChart(v, at);
  return { zoom: z, x: at.x - p.x * z, y: at.y - p.y * z };
}

/**
 * The zoom a wheel step makes: a mouse wheel's notch is about 10 %; a
 * touchpad pinch (ctrlKey, small deltas) follows the fingers. deltaMode 1
 * counts lines, 2 pages.
 */
export function wheelZoom(zoom: number, deltaY: number, deltaMode: number, pinch: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const k = pinch ? 0.01 : 0.0012;
  return clampZoom(zoom * Math.exp(-px * k));
}

/** The smallest rectangle around rects, or null for none. */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.width);
    bottom = Math.max(bottom, r.y + r.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The viewport that shows all of bounds in a canvas of width × height,
 * centered, with pad around, no closer than maxZoom; for no bounds, the
 * chart's origin near the top left at 100 %.
 */
export function fitView(bounds: Rect | null, width: number, height: number, pad = 48, maxZoom = 1): Viewport {
  if (!bounds || width <= 0 || height <= 0) return { x: pad, y: pad, zoom: 1 };
  const zoom = clampZoom(
    Math.min(maxZoom, (width - pad * 2) / Math.max(bounds.width, 1), (height - pad * 2) / Math.max(bounds.height, 1)),
  );
  return {
    zoom,
    x: (width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (height - bounds.height * zoom) / 2 - bounds.y * zoom,
  };
}

/**
 * The viewport that shows all of r in a canvas of width × height, pad in
 * from its edges: v itself when it already does, else moved as little as
 * it takes, zoomed out (never in) when r is too large at v's zoom.
 */
export function revealView(v: Viewport, r: Rect, width: number, height: number, pad = 32): Viewport {
  if (width <= 0 || height <= 0) return v;
  const left = r.x * v.zoom + v.x;
  const top = r.y * v.zoom + v.y;
  const w = r.width * v.zoom;
  const h = r.height * v.zoom;
  if (left >= pad && top >= pad && left + w <= width - pad && top + h <= height - pad) return v;
  const zoom = clampZoom(Math.min(v.zoom, (width - pad * 2) / Math.max(r.width, 1), (height - pad * 2) / Math.max(r.height, 1)));
  if (zoom < v.zoom) return fitView(r, width, height, pad, zoom);
  // Just over the edge it was: the least move that brings it in.
  const dx = left < pad ? pad - left : left + w > width - pad ? width - pad - (left + w) : 0;
  const dy = top < pad ? pad - top : top + h > height - pad ? height - pad - (top + h) : 0;
  return { zoom: v.zoom, x: v.x + dx, y: v.y + dy };
}

/** The rectangle between two corners, in any order. */
export function rectBetween(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Whether two rectangles overlap, touching or more. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export function snap(value: number, grid: number): number {
  return grid > 0 ? Math.round(value / grid) * grid : value;
}

/** Where lines leave a card: the middle of its right side. */
export function outPort(r: Rect): Point {
  return { x: r.x + r.width, y: r.y + r.height / 2 };
}

/** Where lines come into a card: the middle of its left side. */
export function inPort(r: Rect): Point {
  return { x: r.x, y: r.y + r.height / 2 };
}

/** Whether p is within r, its edges included. */
export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/**
 * The handles of the curve from a to b: out to the right of a, in from the
 * left of b, further apart the further they are. A line back into the same
 * card (back) leaves and comes in on its right side: both handles go right.
 */
function handles(a: Point, b: Point, back: boolean): [Point, Point] {
  if (back) {
    const reach = 28 + Math.min(80, Math.abs(b.y - a.y) / 3);
    return [
      { x: a.x + reach, y: a.y },
      { x: b.x + reach, y: b.y },
    ];
  }
  const reach = Math.max(36, Math.abs(b.x - a.x) / 2, Math.min(120, Math.abs(b.y - a.y) / 2));
  return [
    { x: a.x + reach, y: a.y },
    { x: b.x - reach, y: b.y },
  ];
}

/** The SVG path of the line from a to b, an S-shaped cubic curve; back, an arc out to the right and back. */
export function curvePath(a: Point, b: Point, back = false): string {
  const [c1, c2] = handles(a, b, back);
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}

/** The middle of the line from a to b, where its button to delete it shows. */
export function curveMiddle(a: Point, b: Point, back = false): Point {
  const [c1, c2] = handles(a, b, back);
  // The cubic at t = 1/2.
  return { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 };
}

/** A side, the middle and the other side of something from start, size long. */
const lines = (start: number, size: number) => [start, start + size / 2, start + size];

/** Where a dragged card goes, and the lines it lines up with (null for none). */
export interface GuideSnap {
  x: number;
  y: number;
  guideX: number | null;
  guideY: number | null;
}

/**
 * Lines up a card being dragged to moving with the others: when its left,
 * middle or right is within distance of another's left, middle or right, it
 * goes there and that line shows; the same for top, middle and bottom. A
 * way that lines up with none snaps to the grid.
 */
export function snapToGuides(moving: Rect, others: readonly Rect[], distance: number, grid: number): GuideSnap {
  const best = (own: number[], targets: number[][]) => {
    let found: { offset: number; line: number } | null = null;
    for (const target of targets.flat()) {
      for (const value of own) {
        const d = Math.abs(target - value);
        if (d <= distance && (!found || d < Math.abs(found.offset))) found = { offset: target - value, line: target };
      }
    }
    return found;
  };
  const sx = best(
    lines(moving.x, moving.width),
    others.map((o) => lines(o.x, o.width)),
  );
  const sy = best(
    lines(moving.y, moving.height),
    others.map((o) => lines(o.y, o.height)),
  );
  return {
    x: sx ? moving.x + sx.offset : snap(moving.x, grid),
    y: sy ? moving.y + sy.offset : snap(moving.y, grid),
    guideX: sx?.line ?? null,
    guideY: sy?.line ?? null,
  };
}

/** Where a line being drawn can end: an item's row on a card, at its handle; ok when it can take the line. */
export interface Port {
  id: number;
  card: Rect;
  at: Point;
  ok: boolean;
}

/**
 * The port a line being drawn to at ends on: over a card, the row of it
 * nearest in height, able to take the line or not (to say why not); else
 * the nearest port within radius that can take it; else none.
 */
export function nearestPort(ports: readonly Port[], at: Point, radius: number): Port | null {
  let over: Port | null = null;
  let overBy = Infinity;
  let near: Port | null = null;
  let nearBy = radius;
  for (const p of ports) {
    if (contains(p.card, at)) {
      const d = Math.abs(at.y - p.at.y);
      if (d < overBy) {
        over = p;
        overBy = d;
      }
    } else if (p.ok) {
      const d = Math.hypot(at.x - p.at.x, at.y - p.at.y);
      if (d <= nearBy) {
        near = p;
        nearBy = d;
      }
    }
  }
  return over ?? near;
}
