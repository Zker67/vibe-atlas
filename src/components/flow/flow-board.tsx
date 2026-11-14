import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Network, Plus, Redo2, Scan, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import { events, type Item, type ItemType } from "@/mygo";
import { depIndex, depProblem, waitingFor } from "@/lib/deps";
import {
  boundsOf,
  clampZoom,
  curveMiddle,
  curvePath,
  fitView,
  inPort,
  outPort,
  overlaps,
  rectBetween,
  snap,
  toChart,
  wheelZoom,
  zoomAt,
  type Point,
  type Rect,
  type Viewport,
} from "@/lib/flow/geometry";
import { record, redoStep, undoStep, lastAt, type FlowStep, type Spot } from "@/lib/flow/history";
import { COLUMN_GAP, GRID, NODE_HEIGHT, NODE_WIDTH, placesOf, tidyPlaces, type Edge } from "@/lib/flow/layout";
import { isComposing, isTypingTarget, overlayOpen } from "@/lib/keys";
import { nextType, TYPES } from "@/lib/labels";
import { buildForest, queueOrder } from "@/lib/tree";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/api";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { IconButton } from "@/components/app/icon-button";
import { TypeIcon } from "@/components/app/item-marks";
import {
  addDep,
  createItem,
  lastTrashAt,
  matchesFilters,
  removeDep,
  select,
  setSelection,
  setTypeFilter,
  toggleSelected,
  useAtlas,
  type TypeFilter,
} from "@/state/atlas";
import { FlowNode } from "./flow-node";
import { loadCanvas, saveSpots, savedViewport, saveViewport, setHistory, setShowDone, useFlow } from "./flow-store";

/** How far the pointer moves before a press becomes a drag, in screen pixels. */
const DRAG_START = 3;
/** The dot grid's step on the chart. */
const DOT_STEP = 24;

/** Where a pointer event is on the canvas el, in its pixels. */
function localIn(el: HTMLElement, e: { clientX: number; clientY: number }): Point {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** A card's rectangle on the chart. */
const cardAt = (p: Point): Rect => ({ x: p.x, y: p.y, width: NODE_WIDTH, height: NODE_HEIGHT });
const edgeKey = (e: Edge) => `${e.fromId}>${e.toId}`;

/** A new item being named on the chart, where it goes, and the line it gets once saved. */
interface Draft {
  at: Point;
  type: ItemType;
  /** otherId's line: out, the new item waits for it; in, it waits for the new item. */
  link: { otherId: number; side: "out" | "in" } | null;
}

/** A line being drawn from a card's handle. */
interface Linking {
  fromId: number;
  side: "out" | "in";
  /** Where the pointer is, on the chart. */
  to: Point;
  overId: number;
  /** Why the card under the pointer cannot take the line, or "". */
  problem: string;
}

/** Puts the keyboard in the detail's title, as Enter does in the queue. */
function editTitle() {
  const el = document.querySelector<HTMLTextAreaElement>("[data-item-title]");
  if (!el) return;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
}

/** The flow chart of the open project: its toolbar, and the board of cards and lines. */
export function FlowBoard() {
  const projectId = useAtlas((s) => s.projectId);
  const items = useAtlas((s) => s.items);
  const deps = useAtlas((s) => s.deps);
  const modules = useAtlas((s) => s.modules);
  const typeFilter = useAtlas((s) => s.typeFilter);
  const moduleFilter = useAtlas((s) => s.moduleFilter);
  const selectedIds = useAtlas((s) => s.selectedIds);
  const selectedId = useAtlas((s) => s.selectedId);
  const saved = useFlow((s) => (s.projectId === projectId && s.loaded ? s.saved : null));
  const showDone = useFlow((s) => s.showDone);
  const history = useFlow((s) => s.history);

  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<Viewport | null>(null);
  const viewRef = useRef<Viewport | null>(null);
  useLayoutEffect(() => {
    viewRef.current = view;
  });
  const [drag, setDrag] = useState<ReadonlyMap<number, Point> | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const [edge, setEdge] = useState("");
  const [hoverEdge, setHoverEdge] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [panning, setPanning] = useState(false);

  // ---- What shows ----

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const index = useMemo(() => depIndex(deps), [deps]);
  const linked = useMemo(() => new Set(deps.flatMap((d) => [d.fromId, d.toId])), [deps]);
  /** The cards, in the queue's order: those the filters leave, done ones only with lines unless asked. */
  const shown = useMemo(() => {
    const at = queueOrder(buildForest(items));
    const list = items.filter((i) => matchesFilters(i, typeFilter, moduleFilter) && (i.status !== "done" || showDone || linked.has(i.id)));
    list.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
    return list;
  }, [items, typeFilter, moduleFilter, showDone, linked]);
  const shownIds = useMemo(() => new Set(shown.map((i) => i.id)), [shown]);
  const edges = useMemo(() => deps.filter((d) => shownIds.has(d.fromId) && shownIds.has(d.toId)), [deps, shownIds]);
  const places = useMemo(
    () => (saved ? placesOf(shown.map((i) => i.id), saved, edges) : new Map<number, Point>()),
    [shown, saved, edges],
  );
  const placeOf = useCallback((id: number) => drag?.get(id) ?? places.get(id), [drag, places]);
  const moduleNames = useMemo(() => new Map(modules.map((m) => [m.id, m.name])), [modules]);

  // Kept for the handlers, which outlive a render.
  const live = useRef({ shown, shownIds, places, edges, saved, projectId, items, deps });
  useLayoutEffect(() => {
    live.current = { shown, shownIds, places, edges, saved, projectId, items, deps };
  });

  // ---- Loading, size, viewport ----

  useEffect(() => {
    void loadCanvas(projectId);
    // Items come back from the trash with their places, or move away.
    return events.changed.on(() => void loadCanvas(useAtlas.getState().projectId));
  }, [projectId]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /** The viewport that shows every card. */
  const fitAll = useCallback((): Viewport => {
    const el = box.current;
    return fitView(boundsOf([...live.current.places.values()].map(cardAt)), el?.clientWidth ?? 0, el?.clientHeight ?? 0);
  }, []);

  // Each project opens where it was left, else showing all of it.
  const viewFor = useRef(0);
  useEffect(() => {
    if (!saved || size.width === 0 || viewFor.current === projectId) return;
    viewFor.current = projectId;
    setView(savedViewport(projectId) ?? fitAll());
  }, [saved, size.width, projectId, fitAll]);

  useEffect(() => {
    if (!view || viewFor.current !== projectId) return;
    const t = window.setTimeout(() => saveViewport(projectId, view), 300);
    return () => window.clearTimeout(t);
  }, [view, projectId]);

  const local = (e: { clientX: number; clientY: number }) => localIn(box.current!, e);

  // The wheel zooms where the pointer is; a touchpad's sideways swipe and Shift+wheel move it.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!viewRef.current || (e.target as HTMLElement).closest("[data-flow-control]")) return;
      e.preventDefault();
      // From the viewport as the steps before left it, rendered or not yet.
      if (!e.ctrlKey && (e.shiftKey || (e.deltaMode === 0 && e.deltaX !== 0))) {
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        setView((v) => v && { ...v, x: v.x - dx, y: v.y - dy });
        return;
      }
      const at = localIn(el, e);
      setView((v) => v && zoomAt(v, wheelZoom(v.zoom, e.deltaY, e.deltaMode, e.ctrlKey), at));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- Changes ----

  /**
   * Saves where cards go. The first save also keeps where every card shown
   * sits now, laid out or not: once some are saved, the chart lays out the
   * others under them, and they would jump.
   */
  const place = useCallback((spots: Spot[]) => {
    const now = live.current;
    const moving = new Set(spots.map((s) => s.itemId));
    const keep: Spot[] = [];
    for (const it of now.shown) {
      const p = now.places.get(it.id);
      if (p && !moving.has(it.id) && !now.saved?.has(it.id)) keep.push({ itemId: it.id, ...p });
    }
    return saveSpots(now.projectId, [...keep, ...spots]);
  }, []);

  const busy = useRef(false);
  /** Runs a step of the history. */
  const runStep = useCallback(
    async (step: FlowStep): Promise<boolean> => {
      switch (step.kind) {
        case "place":
          return place(step.after);
        case "link":
          return addDep(step.fromId, step.toId);
        case "unlink":
          return removeDep(step.fromId, step.toId);
      }
    },
    [place],
  );
  /** Makes a step and keeps it to undo. */
  const make = useCallback(
    async (step: FlowStep) => {
      if (await runStep(step)) setHistory(record(useFlow.getState().history, step, Date.now()));
    },
    [runStep],
  );
  const travel = useCallback(
    async (back: boolean) => {
      if (busy.current) return;
      const t = (back ? undoStep : redoStep)(useFlow.getState().history);
      if (!t) return;
      busy.current = true;
      try {
        setHistory((await runStep(t.run)) ? t.done : t.failed);
      } finally {
        busy.current = false;
      }
    },
    [runStep],
  );

  /** Lays out every card shown afresh, from where they start now. */
  const tidy = useCallback(() => {
    const now = live.current;
    // Nothing to tidy, or the saved places are not read yet.
    const b = boundsOf([...now.places.values()].map(cardAt));
    if (now.shown.length === 0 || !b) return;
    const next = tidyPlaces(
      now.shown.map((i) => i.id),
      now.edges,
      { x: snap(b.x, GRID), y: snap(b.y, GRID) },
    );
    const before: Spot[] = [];
    const after: Spot[] = [];
    for (const [id, p] of next) {
      const was = now.places.get(id)!;
      before.push({ itemId: id, ...was });
      after.push({ itemId: id, ...p });
    }
    void make({ kind: "place", before, after }).then(() => setView(fitAll()));
  }, [make, fitAll]);

  const link = useCallback(
    async (fromId: number, toId: number) => {
      await make({ kind: "link", fromId, toId });
    },
    [make],
  );
  const unlink = useCallback(
    (key: string) => {
      const [fromId, toId] = key.split(">").map(Number) as [number, number];
      setEdge("");
      setHoverEdge("");
      void make({ kind: "unlink", fromId, toId });
    },
    [make],
  );

  /** Opens the field of a new item, its card centered on at (a point of the chart), or by a card's side for a line. */
  const openDraft = useCallback((at: Point, line: Draft["link"] = null) => {
    const kind = useAtlas.getState().typeFilter;
    const x = !line ? at.x - NODE_WIDTH / 2 : line.side === "out" ? at.x : at.x - NODE_WIDTH;
    setDraft({
      at: { x: snap(x, GRID), y: snap(at.y - NODE_HEIGHT / 2, GRID) },
      type: kind === "all" ? "improve" : kind,
      link: line,
    });
  }, []);

  const centerPoint = useCallback((): Point => {
    const v = viewRef.current;
    const el = box.current;
    if (!v || !el) return { x: 0, y: 0 };
    return toChart(v, { x: el.clientWidth / 2, y: el.clientHeight / 2 });
  }, []);

  // ---- The pointer ----

  /**
   * Follows the pointer of e until it is released, then stops. The board
   * captures it, so that it is followed out of the window too.
   */
  const follow = (e: ReactPointerEvent, onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) => {
    try {
      box.current?.setPointerCapture(e.pointerId);
    } catch {
      // Not a pointer that can be captured: followed within the window.
    }
    const move = (ev: PointerEvent) => onMove(ev);
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onUp(ev);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const startPan = (e: ReactPointerEvent) => {
    const v = viewRef.current;
    if (!v) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    setPanning(true);
    follow(
      e,
      (m) => setView({ ...v, x: v.x + m.clientX - start.x, y: v.y + m.clientY - start.y }),
      () => setPanning(false),
    );
  };

  const startDrag = (e: ReactPointerEvent, id: number) => {
    const v = viewRef.current;
    if (!v) return;
    const additive = e.ctrlKey || e.metaKey;
    const extend = e.shiftKey;
    if (!additive && !extend && !useAtlas.getState().selectedIds.has(id)) select(id);
    const start = { x: e.clientX, y: e.clientY };
    let moving: number[] | null = null;
    let origin = new Map<number, Point>();
    let last: Map<number, Point> | null = null;
    follow(
      e,
      (m) => {
        if (!moving) {
          if (Math.hypot(m.clientX - start.x, m.clientY - start.y) < DRAG_START) return;
          const s = useAtlas.getState();
          let ids = s.selectedIds;
          if (!ids.has(id)) {
            ids = new Set([...(additive || extend ? ids : []), id]);
            setSelection(ids, id);
          }
          const now = live.current;
          moving = [...ids].filter((i) => now.shownIds.has(i) && now.places.has(i));
          origin = new Map(moving.map((i) => [i, now.places.get(i)!]));
        }
        const anchor = origin.get(id)!;
        const dx = snap(anchor.x + (m.clientX - start.x) / v.zoom, GRID) - anchor.x;
        const dy = snap(anchor.y + (m.clientY - start.y) / v.zoom, GRID) - anchor.y;
        last = new Map(moving.map((i) => [i, { x: origin.get(i)!.x + dx, y: origin.get(i)!.y + dy }]));
        setDrag(last);
      },
      () => {
        if (!moving) {
          // A click: Ctrl adds or takes out, Shift adds, else it alone.
          if (additive) toggleSelected(id);
          else if (extend) setSelection([...useAtlas.getState().selectedIds, id], id);
          else select(id);
          return;
        }
        const final = last;
        if (final && [...final].some(([i, p]) => p.x !== origin.get(i)!.x || p.y !== origin.get(i)!.y)) {
          const before = [...origin].map(([itemId, p]) => ({ itemId, ...p }));
          const after = [...final].map(([itemId, p]) => ({ itemId, ...p }));
          void make({ kind: "place", before, after });
        }
        setDrag(null);
      },
    );
  };

  const startLink = (e: ReactPointerEvent, fromId: number, side: "out" | "in") => {
    const v = viewRef.current;
    if (!v) return;
    e.preventDefault();
    e.stopPropagation();
    const problemFor = (overId: number) => {
      const now = live.current;
      // depProblem(id, other, "before"): id would wait for other.
      return side === "out"
        ? depProblem(now.items, now.deps, overId, fromId, "before")
        : depProblem(now.items, now.deps, fromId, overId, "before");
    };
    const at = (m: { clientX: number; clientY: number }) => {
      const over = document.elementFromPoint(m.clientX, m.clientY)?.closest<HTMLElement>("[data-flow-node]");
      const overId = over ? Number(over.dataset.id) : 0;
      return { to: toChart(viewRef.current ?? v, local(m)), overId: overId === fromId ? 0 : overId };
    };
    const first = at(e);
    setLinking({ fromId, side, ...first, problem: first.overId ? problemFor(first.overId) : "" });
    follow(
      e,
      (m) => {
        const next = at(m);
        setLinking({ fromId, side, ...next, problem: next.overId ? problemFor(next.overId) : "" });
      },
      (u) => {
        setLinking(null);
        const end = at(u);
        if (end.overId) {
          const problem = problemFor(end.overId);
          if (problem) toast.error(`不能连这两条：${problem}`);
          else void (side === "out" ? link(fromId, end.overId) : link(end.overId, fromId));
          return;
        }
        // Let go over empty chart: a new item there, which gets the line.
        const target = document.elementFromPoint(u.clientX, u.clientY);
        if (target && box.current?.contains(target) && !target.closest("[data-flow-control], [data-flow-node]")) {
          openDraft(end.to, { otherId: fromId, side });
        }
      },
    );
  };

  const startMarquee = (e: ReactPointerEvent) => {
    const v = viewRef.current;
    if (!v) return;
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const base = additive ? new Set(useAtlas.getState().selectedIds) : new Set<number>();
    const start = local(e);
    let moved = false;
    follow(
      e,
      (m) => {
        const now = local(m);
        if (!moved && Math.hypot(now.x - start.x, now.y - start.y) < DRAG_START) return;
        moved = true;
        const rect = rectBetween(start, now);
        setMarquee(rect);
        const a = toChart(v, { x: rect.x, y: rect.y });
        const area = { ...a, width: rect.width / v.zoom, height: rect.height / v.zoom };
        const hit = [...live.current.places].filter(([, p]) => overlaps(cardAt(p), area)).map(([id]) => id);
        const next = new Set([...base, ...hit]);
        setSelection(next, hit.at(-1) ?? useAtlas.getState().selectedId);
      },
      () => {
        setMarquee(null);
        if (!moved && !additive) select(0);
      },
    );
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-flow-control]")) return;
    box.current?.focus({ preventScroll: true });
    const node = target.closest<HTMLElement>("[data-flow-node]");
    if (e.button === 1 || (e.button === 2 && !node)) {
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const port = target.closest<HTMLElement>("[data-flow-port]");
    if (port && node) {
      startLink(e, Number(node.dataset.id), port.dataset.flowPort === "in" ? "in" : "out");
      return;
    }
    // The card's own buttons keep their clicks.
    if (target.closest("button, input, textarea")) return;
    if (node) {
      setEdge("");
      startDrag(e, Number(node.dataset.id));
      return;
    }
    const line = target.closest<SVGElement>("[data-flow-edge]");
    if (line) {
      setEdge(line.dataset.flowEdge ?? "");
      return;
    }
    setEdge("");
    startMarquee(e);
  };

  // ---- Keys: before the window's own (main-app.tsx), which skip what these take ----

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isComposing(e) || e.altKey) return;
      if (overlayOpen() || isTypingTarget(document.activeElement)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const take = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (mod && (key === "z" || key === "y")) {
        const redo = key === "y" || e.shiftKey;
        const h = useFlow.getState().history;
        // The deletion made since the chart's last step is undone first, by the window.
        if (!redo && (lastAt(h) === 0 || lastTrashAt() > lastAt(h))) return;
        if (redo && h.future.length === 0) return;
        take();
        void travel(!redo);
        return;
      }
      if (mod && key === "a" && !e.shiftKey) {
        take();
        const ids = live.current.shown.map((i) => i.id);
        if (ids.length) setSelection(ids, useAtlas.getState().selectedId || ids.at(-1)!, ids[0]);
        return;
      }
      if (mod || e.shiftKey) return;
      if (edge && (key === "Delete" || key === "Backspace")) {
        take();
        unlink(edge);
        return;
      }
      if (edge && key === "Escape") {
        take();
        setEdge("");
        return;
      }
      if (key === "n") {
        take();
        openDraft(centerPoint());
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [edge, travel, unlink, openDraft, centerPoint]);

  // ---- Drawing ----

  const v = view;
  const lines = edges.map((d) => {
    const from = placeOf(d.fromId);
    const to = placeOf(d.toId);
    if (!from || !to) return null;
    const a = outPort(cardAt(from));
    const b = inPort(cardAt(to));
    const key = edgeKey(d);
    return { key, a, b, waiting: byId.get(d.fromId)?.status !== "done" };
  });
  // The lines live in an SVG as large as the chart, so that they take the pointer only where they are.
  const area = boundsOf([...[...places.keys()].map((id) => cardAt(placeOf(id)!)), ...(linking ? [{ ...linking.to, width: 1, height: 1 }] : [])]);
  const pad = 240;
  const svgBox = area ? { x: area.x - pad, y: area.y - pad, width: area.width + pad * 2, height: area.height + pad * 2 } : null;
  const shownEdge = hoverEdge || edge;
  const middle = (() => {
    const l = lines.find((x) => x?.key === shownEdge);
    return l ? curveMiddle(l.a, l.b) : null;
  })();
  const linkFrom = linking && placeOf(linking.fromId);
  const dot = v ? (() => {
    let step = DOT_STEP * v.zoom;
    while (step < 12) step *= 2;
    return step;
  })() : DOT_STEP;

  const empty = shown.length === 0;
  const hiddenDone = !showDone && items.some((i) => i.status === "done" && matchesFilters(i, typeFilter, moduleFilter) && !linked.has(i.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FlowToolbar
        typeFilter={typeFilter}
        showDone={showDone}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onTidy={tidy}
        onUndo={() => void travel(true)}
        onRedo={() => void travel(false)}
        onAdd={() => openDraft(centerPoint())}
      />
      <div
        ref={box}
        tabIndex={-1}
        data-linking={linking ? "" : undefined}
        onPointerDown={onPointerDown}
        onDoubleClick={(e) => {
          // The pointer was captured: what is under it, not the event's target.
          const t = document.elementFromPoint(e.clientX, e.clientY);
          if (!v || !t || t.closest("[data-flow-control], [data-flow-edge], button")) return;
          const node = t.closest<HTMLElement>("[data-flow-node]");
          if (node) {
            select(Number(node.dataset.id));
            editTitle();
            return;
          }
          openDraft(toChart(v, local(e)));
        }}
        onContextMenu={(e) => {
          // Right-dragging moves the chart; only the cards have a menu.
          if (!(e.target as HTMLElement).closest("[data-flow-node]")) e.preventDefault();
        }}
        className={cn("flow-board relative min-h-0 flex-1 overflow-hidden outline-none", panning && "cursor-grabbing")}
        style={
          v
            ? { backgroundSize: `${dot}px ${dot}px`, backgroundPosition: `${v.x}px ${v.y}px` }
            : undefined
        }
      >
        {v && (
          <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.zoom})` }}>
            {svgBox && (
              <svg
                aria-hidden
                className="pointer-events-none absolute overflow-visible"
                style={{ left: svgBox.x, top: svgBox.y, width: svgBox.width, height: svgBox.height }}
              >
                <defs>
                  <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 1 L 9 5 L 0 9 z" className="fill-muted-foreground/70" />
                  </marker>
                  <marker id="flow-arrow-wait" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 1 L 9 5 L 0 9 z" className="fill-doing" />
                  </marker>
                  <marker id="flow-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 1 L 9 5 L 0 9 z" className="fill-primary" />
                  </marker>
                </defs>
                <g transform={`translate(${-svgBox.x} ${-svgBox.y})`}>
                  {lines.map((l) => {
                    if (!l) return null;
                    const d = curvePath(l.a, l.b);
                    const on = l.key === edge || l.key === hoverEdge;
                    return (
                      <g
                        key={l.key}
                        data-flow-edge={l.key}
                        onPointerEnter={() => setHoverEdge(l.key)}
                        onPointerLeave={() => setHoverEdge((h) => (h === l.key ? "" : h))}
                      >
                        <path d={d} fill="none" stroke="transparent" strokeWidth={14} className="cursor-pointer" style={{ pointerEvents: "stroke" }} />
                        <path
                          d={d}
                          fill="none"
                          markerEnd={`url(#${on ? "flow-arrow-on" : l.waiting ? "flow-arrow-wait" : "flow-arrow"})`}
                          className={cn(
                            "flow-edge",
                            l.waiting ? "flow-edge-waiting stroke-doing" : "stroke-muted-foreground/60",
                            on && "stroke-primary",
                            l.key === edge && "flow-edge-selected",
                          )}
                        />
                      </g>
                    );
                  })}
                  {linking && linkFrom && (
                    <path
                      d={
                        linking.side === "out"
                          ? curvePath(outPort(cardAt(linkFrom)), linking.to)
                          : curvePath(linking.to, inPort(cardAt(linkFrom)))
                      }
                      fill="none"
                      markerEnd="url(#flow-arrow-on)"
                      className={cn("flow-edge stroke-primary", linking.problem && "stroke-destructive")}
                    />
                  )}
                </g>
              </svg>
            )}
            {shown.map((item) => {
              const p = placeOf(item.id);
              if (!p) return null;
              const parent = item.parentId ? (byId.get(item.parentId)?.title ?? "") : "";
              const waiting = waitingFor(item, byId, index);
              const target = linking?.overId === item.id ? (linking.problem ? "no" : "ok") : "";
              return (
                <FlowNode
                  key={item.id}
                  item={item}
                  x={p.x}
                  y={p.y}
                  selected={selectedIds.has(item.id)}
                  focus={item.id === selectedId && selectedIds.size > 1}
                  waiting={waiting.map((w) => w.title).join("\n")}
                  parent={parent}
                  module={moduleFilter === "all" ? (moduleNames.get(item.moduleId) ?? "") : ""}
                  target={target}
                  dragging={!!drag?.has(item.id)}
                />
              );
            })}
            {middle && (
              <button
                type="button"
                data-flow-control=""
                aria-label="删除这条前置关系"
                title="删除这条前置关系（Delete）"
                onPointerEnter={() => setHoverEdge(shownEdge)}
                onClick={() => unlink(shownEdge)}
                className="absolute top-0 left-0 grid size-5 place-items-center rounded-full border bg-popover text-muted-foreground shadow-sm hover:border-destructive/60 hover:text-destructive"
                style={{ transform: `translate(${middle.x}px, ${middle.y}px) translate(-50%, -50%) scale(${1 / v.zoom})` }}
              >
                <X className="size-3" />
              </button>
            )}
            {draft && (
              <DraftCard
                key={`${draft.at.x},${draft.at.y}`}
                draft={draft}
                onType={(type) => setDraft((d) => (d ? { ...d, type } : d))}
                onClose={() => setDraft(null)}
                onSaved={(item, chain) => {
                  const at = draft.at;
                  void place([{ itemId: item.id, ...at }]);
                  if (draft.link) {
                    const { otherId, side } = draft.link;
                    void (side === "out" ? addDep(otherId, item.id) : addDep(item.id, otherId));
                  }
                  select(item.id);
                  setDraft(
                    chain
                      ? { at: { x: at.x + NODE_WIDTH + COLUMN_GAP, y: at.y }, type: draft.type, link: { otherId: item.id, side: "out" } }
                      : null,
                  );
                  if (!chain) box.current?.focus({ preventScroll: true });
                }}
              />
            )}
          </div>
        )}
        {marquee && (
          <div
            aria-hidden
            className="pointer-events-none absolute z-20 rounded-[4px] border border-primary/60 bg-primary/10"
            style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
          />
        )}
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center text-muted-foreground">
            <Network className="mb-1 size-8 opacity-50" />
            <p className="text-base font-medium text-foreground">{items.length ? "没有要显示的改进点" : "还没有改进点"}</p>
            <p className="text-xs">{hiddenDone ? "已完成的没有显示，可以在上方打开" : "双击空白处，或按 N 新建一条"}</p>
          </div>
        )}
        {v && (
          <ZoomBar
            zoom={v.zoom}
            onZoom={(zoom) => {
              const el = box.current!;
              setView(zoomAt(v, zoom, { x: el.clientWidth / 2, y: el.clientHeight / 2 }));
            }}
            onFit={() => setView(fitAll())}
          />
        )}
      </div>
    </div>
  );
}

/** The toolbar over the chart: the kinds to show, done ones or not; adding, tidying, undoing. */
function FlowToolbar({
  typeFilter,
  showDone,
  canUndo,
  canRedo,
  onTidy,
  onUndo,
  onRedo,
  onAdd,
}: {
  typeFilter: TypeFilter;
  showDone: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onTidy(): void;
  onUndo(): void;
  onRedo(): void;
  onAdd(): void;
}) {
  return (
    <div className="@container flex h-10 shrink-0 items-center gap-1 border-b px-2">
      <ToggleGroup
        type="single"
        size="sm"
        spacing={0.5}
        value={typeFilter === "all" ? "" : typeFilter}
        onValueChange={(v) => setTypeFilter((v || "all") as TypeFilter)}
        aria-label="按类型筛选"
      >
        {TYPES.map((t) => (
          <ToggleGroupItem
            key={t.value}
            value={t.value}
            aria-label={t.label}
            title={t.label}
            className="rounded-full px-2.5 text-muted-foreground data-[state=on]:text-foreground"
          >
            <t.icon className={t.text} />
            <span className="hidden @min-[640px]:inline">{t.label}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <IconButton
        label={showDone ? "隐藏已完成（连着线的仍显示）" : "显示已完成"}
        size="icon-sm"
        aria-pressed={showDone}
        className={cn("text-muted-foreground", showDone && "bg-muted text-foreground")}
        onClick={() => setShowDone(!showDone)}
      >
        {showDone ? <Eye /> : <EyeOff />}
      </IconButton>
      <div className="ml-auto flex items-center gap-0.5">
        <IconButton label="新建一条" shortcut="N" size="icon-sm" className="text-muted-foreground" onClick={onAdd}>
          <Plus />
        </IconButton>
        <IconButton label="一键整理：前置在左，后续在右" size="icon-sm" className="text-muted-foreground" onClick={onTidy}>
          <Network />
        </IconButton>
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <IconButton label="撤回" shortcut="Ctrl+Z" size="icon-sm" className="text-muted-foreground" disabled={!canUndo} onClick={onUndo}>
          <Undo2 />
        </IconButton>
        <IconButton label="重做" shortcut="Ctrl+Shift+Z" size="icon-sm" className="text-muted-foreground" disabled={!canRedo} onClick={onRedo}>
          <Redo2 />
        </IconButton>
      </div>
    </div>
  );
}

/** Bottom right of the chart: zoom out, the zoom (a click goes back to 100 %), zoom in, show everything. */
function ZoomBar({ zoom, onZoom, onFit }: { zoom: number; onZoom(zoom: number): void; onFit(): void }) {
  return (
    <div
      data-flow-control=""
      className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-lg border bg-popover/95 p-0.5 shadow-sm"
    >
      <IconButton label="缩小" size="icon-xs" className="text-muted-foreground" onClick={() => onZoom(clampZoom(zoom / 1.25))}>
        <ZoomOut />
      </IconButton>
      <button
        type="button"
        title="回到 100%"
        onClick={() => onZoom(1)}
        className="meta-mono h-6 w-12 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {Math.round(zoom * 100)}%
      </button>
      <IconButton label="放大" size="icon-xs" className="text-muted-foreground" onClick={() => onZoom(clampZoom(zoom * 1.25))}>
        <ZoomIn />
      </IconButton>
      <IconButton label="显示全部" size="icon-xs" className="text-muted-foreground" onClick={onFit}>
        <Scan />
      </IconButton>
    </div>
  );
}

/**
 * The card of a new item being named on the chart: Enter saves it, Shift+
 * Enter saves it and names the next one, to its right and waiting for it;
 * Tab changes its kind; Escape, or leaving it empty, gives it up. Leaving
 * it with a title saves it.
 */
function DraftCard({
  draft,
  onType,
  onClose,
  onSaved,
}: {
  draft: Draft;
  onType(type: ItemType): void;
  onClose(): void;
  onSaved(item: Item, chain: boolean): void;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const saving = useRef(false);
  const save = async (chain: boolean) => {
    const text = title.trim();
    if (!text) {
      onClose();
      return;
    }
    if (saving.current) return;
    saving.current = true;
    const { moduleFilter } = useAtlas.getState();
    try {
      const item = await createItem(text, draft.type, typeof moduleFilter === "number" ? moduleFilter : 0);
      onSaved(item, chain);
    } catch (e) {
      setError(errorMessage(e));
      saving.current = false;
    }
  };
  return (
    <div
      data-flow-control=""
      className="absolute top-0 left-0 flex flex-col justify-center gap-1 rounded-lg border border-primary bg-card px-2.5 py-2 shadow-lg ring-3 ring-ring/30"
      style={{ transform: `translate(${draft.at.x}px, ${draft.at.y}px)`, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          tabIndex={-1}
          title="切换类型（Tab）"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onType(nextType(draft.type))}
          className="grid size-5 shrink-0 place-items-center rounded-sm hover:bg-muted"
        >
          <TypeIcon type={draft.type} />
        </button>
        <input
          autoFocus
          value={title}
          maxLength={300}
          placeholder={draft.link ? (draft.link.side === "out" ? "新的一条，等前一条做完" : "新的一条，做完它再做后一条") : "新的一条"}
          aria-label="新改进点的标题"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          onChange={(e) => {
            setTitle(e.target.value);
            setError("");
          }}
          onBlur={() => {
            if (!saving.current) void save(false);
          }}
          onKeyDown={(e) => {
            if (isComposing(e)) return;
            if (e.key === "Enter") {
              e.preventDefault();
              void save(e.shiftKey);
            } else if (e.key === "Escape") {
              e.preventDefault();
              saving.current = true;
              onClose();
            } else if (e.key === "Tab") {
              e.preventDefault();
              onType(nextType(draft.type, e.shiftKey));
            }
          }}
        />
      </div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">Enter 保存 · Shift+Enter 接着写下一条 · Tab 换类型</p>
      )}
    </div>
  );
}
