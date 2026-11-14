import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  Eye,
  EyeOff,
  Keyboard,
  Move,
  Network,
  Plus,
  Redo2,
  Scan,
  SquareDashedMousePointer,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { events, type Item, type ItemType } from "@/mygo";
import { depIndex, depProblem, waitingFor } from "@/lib/deps";
import {
  boundsOf,
  clampZoom,
  curveMiddle,
  curvePath,
  fitView,
  nearestPort,
  overlaps,
  rectBetween,
  snap,
  snapToGuides,
  toChart,
  toScreen,
  wheelZoom,
  zoomAt,
  type Point,
  type Port,
  type Rect,
  type Viewport,
} from "@/lib/flow/geometry";
import { lastAt, record, redoStep, stepLabel, undoStep, type FlowStep, type Spot } from "@/lib/flow/history";
import { cardEdges, cardHeight, cardsOf, COLUMN_GAP, GRID, NODE_HEIGHT, NODE_WIDTH, placesOf, rowMiddle, tidyPlaces, type Edge } from "@/lib/flow/layout";
import { isComposing, isTypingTarget, overlayOpen } from "@/lib/keys";
import { nextType } from "@/lib/labels";
import { buildForest, progress, queueOrder } from "@/lib/tree";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IconButton } from "@/components/app/icon-button";
import { TypeIcon } from "@/components/app/item-marks";
import { addDep, createItem, lastTrashAt, matchesFilters, removeDep, select, setSelection, toggleSelected, useAtlas } from "@/state/atlas";
import { FlowCard, type FlowRowData, type LinkView } from "./flow-node";
import { loadCanvas, saveSpots, savedViewport, saveViewport, setHintsOpen, setHistory, setShowDone, useFlow } from "./flow-store";

/** How far the pointer moves before a press becomes a drag, in screen pixels. */
const DRAG_START = 3;
/** The dot grid's step on the chart. */
const DOT_STEP = 24;
/** How near a handle, in screen pixels, a line being drawn goes to it. */
const LINK_RADIUS = 28;
/** How near, in screen pixels, a dragged card lines up with another. */
const GUIDE_SNAP = 6;
/** How far the pointer may move between pressing the right button and letting go, for a menu rather than a pan. */
const MENU_SLOP = 4;

/** Where a pointer event is on the canvas el, in its pixels. */
function localIn(el: HTMLElement, e: { clientX: number; clientY: number }): Point {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

const edgeKey = (e: Edge) => `${e.fromId}>${e.toId}`;

/** A title, short enough for a hint. */
const clip = (title: string) => (title.length > 14 ? `${title.slice(0, 13)}…` : title);

/** A new item being named on the chart, where it goes, and the line it gets once saved. */
interface Draft {
  at: Point;
  type: ItemType;
  /** otherId's line: out, the new item waits for it; in, it waits for the new item. */
  link: { otherId: number; side: "out" | "in" } | null;
}

/** A line being drawn from an item's handle. */
interface Linking {
  view: LinkView;
  /** Where the pointer is, on the chart. */
  to: Point;
  /** The handle it would land on. */
  over: Port | null;
  /** The pointer is over empty chart: letting go names a new item there. */
  blank: boolean;
}

/** What the board's own menu is for: the empty chart at a point, or a line. */
type BoardMenu = { kind: "pane"; at: Point } | { kind: "edge"; key: string };

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
  const [guides, setGuides] = useState<{ x: number | null; y: number | null } | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const [edge, setEdge] = useState("");
  const [hoverEdge, setHoverEdge] = useState("");
  const [hoverCard, setHoverCard] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [panning, setPanning] = useState(false);
  const [menu, setMenu] = useState<BoardMenu | null>(null);
  /** Where the right button went down, to tell a menu from a pan. */
  const rightDown = useRef<Point | null>(null);
  /** What a menu item does once the menu is gone (its focus going back would close a field it opens). */
  const afterMenu = useRef<(() => void) | null>(null);
  /** Stops drawing the line being drawn (Escape). */
  const cancelLink = useRef<(() => void) | null>(null);

  // ---- What shows ----

  const forest = useMemo(() => buildForest(items), [items]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const index = useMemo(() => depIndex(deps), [deps]);
  const linked = useMemo(() => new Set(deps.flatMap((d) => [d.fromId, d.toId])), [deps]);
  /** The items shown, in the queue's order: those of the module chosen, done ones only with lines unless asked. */
  const shown = useMemo(() => {
    const at = queueOrder(forest);
    const list = items.filter((i) => matchesFilters(i, "all", moduleFilter) && (i.status !== "done" || showDone || linked.has(i.id)));
    list.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
    return list;
  }, [items, forest, moduleFilter, showDone, linked]);
  const shownIds = useMemo(() => new Set(shown.map((i) => i.id)), [shown]);
  /** An item with the items under it shown is one card. */
  const cards = useMemo(
    () =>
      cardsOf(
        shown.map((i) => i.id),
        (id) => byId.get(id)?.parentId ?? 0,
      ),
    [shown, byId],
  );
  const heightOf = useCallback((root: number) => cardHeight(cards.rows.get(root)?.length ?? 0), [cards]);
  const edges = useMemo(() => deps.filter((d) => shownIds.has(d.fromId) && shownIds.has(d.toId)), [deps, shownIds]);
  /** The lines between cards, which lay them out. */
  const between = useMemo(() => cardEdges(edges, cards.rootOf), [edges, cards]);
  const places = useMemo(
    () => (saved ? placesOf(cards.roots, saved, between, heightOf) : new Map<number, Point>()),
    [cards, saved, between, heightOf],
  );
  const placeOf = useCallback((root: number) => drag?.get(root) ?? places.get(root), [drag, places]);
  const moduleNames = useMemo(() => new Map(modules.map((m) => [m.id, m.name])), [modules]);
  const rowsOf = useMemo(
    () => new Map([...cards.rows].map(([root, rows]) => [root, rows.map((r): FlowRowData => ({ item: byId.get(r.id)!, depth: r.depth }))])),
    [cards, byId],
  );
  const waits = useMemo(() => {
    const out = new Map<number, string>();
    for (const it of shown) {
      const titles = waitingFor(it, byId, index).map((w) => w.title);
      if (titles.length) out.set(it.id, titles.join("\n"));
    }
    return out;
  }, [shown, byId, index]);

  // Kept for the handlers, which outlive a render.
  const live = useRef({ shown, cards, heightOf, places, between, saved, projectId, items, deps });
  useLayoutEffect(() => {
    live.current = { shown, cards, heightOf, places, between, saved, projectId, items, deps };
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
    const now = live.current;
    const rects = [...now.places].map(([id, p]): Rect => ({ ...p, width: NODE_WIDTH, height: now.heightOf(id) }));
    return fitView(boundsOf(rects), el?.clientWidth ?? 0, el?.clientHeight ?? 0);
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
    for (const id of now.cards.roots) {
      const p = now.places.get(id);
      if (p && !moving.has(id) && !now.saved?.has(id)) keep.push({ itemId: id, ...p });
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
  /** Makes a step and keeps it to undo; false when it failed. */
  const make = useCallback(
    async (step: FlowStep) => {
      const ok = await runStep(step);
      if (ok) setHistory(record(useFlow.getState().history, step, Date.now()));
      return ok;
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
  /** A hint's 撤回: undoes step only while it is the last one. */
  const undoIfLatest = useCallback(
    (step: FlowStep) => {
      if (useFlow.getState().history.past.at(-1)?.step === step) void travel(true);
      else toast("之后还有别的改动，请按 Ctrl+Z 逐步撤回", { id: "flow-undo" });
    },
    [travel],
  );

  /** Lays out every card shown afresh, from where they start now. */
  const tidy = useCallback(() => {
    const now = live.current;
    // Nothing to tidy, or the saved places are not read yet.
    const b = boundsOf([...now.places].map(([id, p]): Rect => ({ ...p, width: NODE_WIDTH, height: now.heightOf(id) })));
    if (now.cards.roots.length === 0 || !b) return;
    const next = tidyPlaces(now.cards.roots, now.between, { x: snap(b.x, GRID), y: snap(b.y, GRID) }, now.heightOf);
    const before: Spot[] = [];
    const after: Spot[] = [];
    for (const [id, p] of next) {
      const was = now.places.get(id)!;
      before.push({ itemId: id, ...was });
      after.push({ itemId: id, ...p });
    }
    void make({ kind: "place", before, after, label: "一键整理" }).then(() => setView(fitAll()));
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
      const step: FlowStep = { kind: "unlink", fromId, toId };
      void make(step).then((ok) => {
        if (!ok) return;
        const titles = [fromId, toId].map((id) => clip(live.current.items.find((i) => i.id === id)?.title ?? ""));
        toast("已删除前置关系", {
          id: "flow-undo",
          description: titles.join(" → "),
          action: { label: "撤回", onClick: () => undoIfLatest(step) },
        });
      });
    },
    [make, undoIfLatest],
  );

  /** Opens the field of a new item, its card centered on at (a point of the chart), or by a card's side for a line. */
  const openDraft = useCallback((at: Point, line: Draft["link"] = null) => {
    const x = !line ? at.x - NODE_WIDTH / 2 : line.side === "out" ? at.x : at.x - NODE_WIDTH;
    setDraft((d) => ({
      at: { x: snap(x, GRID), y: snap(at.y - NODE_HEIGHT / 2, GRID) },
      type: d?.type ?? "improve",
      link: line,
    }));
  }, []);

  const centerPoint = useCallback((): Point => {
    const v = viewRef.current;
    const el = box.current;
    if (!v || !el) return { x: 0, y: 0 };
    return toChart(v, { x: el.clientWidth / 2, y: el.clientHeight / 2 });
  }, []);

  const selectAll = useCallback(() => {
    const ids = live.current.shown.map((i) => i.id);
    if (ids.length) setSelection(ids, useAtlas.getState().selectedId || ids.at(-1)!, ids[0]);
  }, []);

  // ---- The pointer ----

  /**
   * Follows the pointer of e until it is released, then stops; the function
   * returned stops sooner. The board captures the pointer, so that it is
   * followed out of the window too.
   */
  const follow = (e: ReactPointerEvent, onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) => {
    try {
      box.current?.setPointerCapture(e.pointerId);
    } catch {
      // Not a pointer that can be captured: followed within the window.
    }
    const move = (ev: PointerEvent) => onMove(ev);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    const up = (ev: PointerEvent) => {
      stop();
      onUp(ev);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return stop;
  };

  const startPan = (e: ReactPointerEvent) => {
    const v = viewRef.current;
    if (!v) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    follow(
      e,
      (m) => {
        if (!moved && Math.hypot(m.clientX - start.x, m.clientY - start.y) < DRAG_START) return;
        moved = true;
        setPanning(true);
        setView({ ...v, x: v.x + m.clientX - start.x, y: v.y + m.clientY - start.y });
      },
      () => setPanning(false),
    );
  };

  /** A press on the item id: a click selects it; a drag moves its card, with the other cards selected. */
  const startDrag = (e: ReactPointerEvent, id: number) => {
    const v = viewRef.current;
    if (!v) return;
    const additive = e.ctrlKey || e.metaKey;
    const extend = e.shiftKey;
    if (!additive && !extend && !useAtlas.getState().selectedIds.has(id)) select(id);
    const start = { x: e.clientX, y: e.clientY };
    const root = live.current.cards.rootOf.get(id) ?? id;
    let moving: number[] | null = null;
    let origin = new Map<number, Point>();
    let others: Rect[] = [];
    let last: Map<number, Point> | null = null;
    follow(
      e,
      (m) => {
        if (!moving) {
          if (Math.hypot(m.clientX - start.x, m.clientY - start.y) < DRAG_START) return;
          let ids = useAtlas.getState().selectedIds;
          if (!ids.has(id)) {
            ids = new Set([...(additive || extend ? ids : []), id]);
            setSelection(ids, id);
          }
          const now = live.current;
          // The cards of the items selected.
          const roots = new Set([root]);
          for (const i of ids) {
            const r = now.cards.rootOf.get(i);
            if (r !== undefined) roots.add(r);
          }
          moving = [...roots].filter((r) => now.places.has(r));
          origin = new Map(moving.map((r) => [r, now.places.get(r)!]));
          others = [...now.places].filter(([r]) => !roots.has(r)).map(([r, p]) => ({ ...p, width: NODE_WIDTH, height: now.heightOf(r) }));
        }
        const anchor = origin.get(root);
        if (!anchor) return;
        const raw = { x: anchor.x + (m.clientX - start.x) / v.zoom, y: anchor.y + (m.clientY - start.y) / v.zoom };
        let to: Point;
        if (moving.length === 1) {
          // One card lines up with the others, else snaps to the grid.
          const g = snapToGuides({ ...raw, width: NODE_WIDTH, height: live.current.heightOf(root) }, others, GUIDE_SNAP / v.zoom, GRID);
          to = { x: g.x, y: g.y };
          setGuides(g.guideX === null && g.guideY === null ? null : { x: g.guideX, y: g.guideY });
        } else {
          to = { x: snap(raw.x, GRID), y: snap(raw.y, GRID) };
        }
        const dx = to.x - anchor.x;
        const dy = to.y - anchor.y;
        last = new Map(moving.map((i) => [i, { x: origin.get(i)!.x + dx, y: origin.get(i)!.y + dy }]));
        setDrag(last);
      },
      () => {
        setGuides(null);
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

  /**
   * Draws a line from the handle on side of fromId. The items that cannot
   * take it fade; near a handle that can (LINK_RADIUS), or over a row, the
   * line goes to it. Let go there, it is a prerequisite; over empty chart,
   * a new item there gets it. Escape stops.
   */
  const startLink = (e: ReactPointerEvent, fromId: number, side: "out" | "in") => {
    const v0 = viewRef.current;
    if (!v0) return;
    e.preventDefault();
    e.stopPropagation();
    const now = live.current;
    const problems = new Map<number, string>();
    // depProblem(id, other, "before"): id would wait for other.
    for (const it of now.shown) {
      if (it.id === fromId) continue;
      problems.set(it.id, side === "out" ? depProblem(now.items, now.deps, it.id, fromId, "before") : depProblem(now.items, now.deps, fromId, it.id, "before"));
    }
    const lv: LinkView = { fromId, side, problems };
    // A line from a right side lands on a left one, and the other way.
    const ports: Port[] = [];
    for (const it of now.shown) {
      if (it.id === fromId) continue;
      const root = now.cards.rootOf.get(it.id)!;
      const p = now.places.get(root);
      if (!p) continue;
      ports.push({
        id: it.id,
        card: { ...p, width: NODE_WIDTH, height: now.heightOf(root) },
        at: { x: side === "out" ? p.x : p.x + NODE_WIDTH, y: p.y + rowMiddle(now.cards.index.get(it.id) ?? -1) },
        ok: !problems.get(it.id),
      });
    }
    const at = (m: { clientX: number; clientY: number }) => {
      const v = viewRef.current ?? v0;
      const to = toChart(v, local(m));
      const over = nearestPort(ports, to, LINK_RADIUS / v.zoom);
      const under = document.elementFromPoint(m.clientX, m.clientY);
      const blank = !over && !!under && !!box.current?.contains(under) && !under.closest("[data-flow-control], [data-flow-node]");
      return { view: lv, to, over, blank };
    };
    setLinking(at(e));
    const stop = follow(
      e,
      (m) => setLinking(at(m)),
      (u) => {
        cancelLink.current = null;
        setLinking(null);
        const end = at(u);
        if (end.over) {
          const problem = problems.get(end.over.id);
          if (problem) toast.error(`不能连这两条：${problem}`);
          else void (side === "out" ? link(fromId, end.over.id) : link(end.over.id, fromId));
          return;
        }
        if (end.blank) openDraft(end.to, { otherId: fromId, side });
      },
    );
    cancelLink.current = () => {
      stop();
      cancelLink.current = null;
      setLinking(null);
    };
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
        // A card touched is its head selected.
        const hit = [...live.current.places]
          .filter(([id, p]) => overlaps({ ...p, width: NODE_WIDTH, height: live.current.heightOf(id) }, area))
          .map(([id]) => id);
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
    if (e.button === 2) rightDown.current = { x: e.clientX, y: e.clientY };
    const node = target.closest<HTMLElement>("[data-flow-node]");
    const row = target.closest<HTMLElement>("[data-flow-item]");
    if (e.button === 1 || (e.button === 2 && !node)) {
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const port = target.closest<HTMLElement>("[data-flow-port]");
    if (port && row) {
      startLink(e, Number(row.dataset.id), port.dataset.flowPort === "in" ? "in" : "out");
      return;
    }
    // The card's own buttons keep their clicks.
    if (target.closest("button, input, textarea")) return;
    if (node) {
      setEdge("");
      startDrag(e, Number(row?.dataset.id ?? node.dataset.id));
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

  /** The board's menu: on empty chart and on lines; the rows have their own, and a right drag moves the chart. */
  const onContextMenu = (e: ReactMouseEvent) => {
    const start = rightDown.current;
    rightDown.current = null;
    const moved = !!start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > MENU_SLOP;
    const v = viewRef.current;
    // The pointer was captured: what is under it, not the event's target.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (moved || !v || !under || under.closest("[data-flow-control], [data-flow-node]")) {
      e.preventDefault();
      return;
    }
    const line = under.closest<SVGElement>("[data-flow-edge]")?.dataset.flowEdge;
    if (line) {
      setEdge(line);
      setMenu({ kind: "edge", key: line });
      return;
    }
    setMenu({ kind: "pane", at: toChart(v, local(e)) });
  };

  // ---- Keys: before the window's own (main-app.tsx), which skip what these take ----

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isComposing(e) || e.altKey) return;
      const take = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.key === "Escape" && cancelLink.current) {
        take();
        cancelLink.current();
        return;
      }
      if (overlayOpen() || isTypingTarget(document.activeElement)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
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
        selectAll();
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
  }, [edge, travel, unlink, openDraft, centerPoint, selectAll]);

  // ---- Drawing ----

  const v = view;
  /** Where an item's handle on side is, on the chart. */
  const portAt = (id: number, side: "out" | "in"): Point | null => {
    const root = cards.rootOf.get(id);
    const p = root === undefined ? undefined : placeOf(root);
    if (!p) return null;
    return { x: side === "out" ? p.x + NODE_WIDTH : p.x, y: p.y + rowMiddle(cards.index.get(id) ?? -1) };
  };
  /** The line from fromId to toId: right side to left side; within a card, out of the right side and back in. */
  const lineOf = (fromId: number, toId: number) => {
    const back = cards.rootOf.get(fromId) === cards.rootOf.get(toId);
    const a = portAt(fromId, "out");
    const b = portAt(toId, back ? "out" : "in");
    return a && b ? { a, b, back } : null;
  };
  const lines = edges.map((d) => {
    const l = lineOf(d.fromId, d.toId);
    if (!l) return null;
    const ends = [cards.rootOf.get(d.fromId), cards.rootOf.get(d.toId)];
    return {
      ...l,
      key: edgeKey(d),
      waiting: byId.get(d.fromId)?.status !== "done",
      // Its card under the pointer, or one of its items selected.
      lit: (hoverCard !== 0 && ends.includes(hoverCard)) || selectedIds.has(d.fromId) || selectedIds.has(d.toId),
    };
  });
  // The lines live in an SVG as large as the chart, so that they take the pointer only where they are.
  const area = boundsOf([
    ...[...places.keys()].map((id): Rect => ({ ...placeOf(id)!, width: NODE_WIDTH, height: heightOf(id) })),
    ...(linking ? [{ ...linking.to, width: 1, height: 1 }] : []),
  ]);
  const pad = 240;
  const svgBox = area ? { x: area.x - pad, y: area.y - pad, width: area.width + pad * 2, height: area.height + pad * 2 } : null;
  const shownEdge = hoverEdge || edge;
  const middle = (() => {
    const l = lines.find((x) => x?.key === shownEdge);
    return l ? curveMiddle(l.a, l.b, l.back) : null;
  })();
  /** The line being drawn: to the handle it would land on, else to the pointer. */
  const drawn = (() => {
    if (!linking) return null;
    const { fromId, side, problems } = linking.view;
    const over = linking.over;
    const problem = over ? (problems.get(over.id) ?? "") : "";
    if (over && !problem) {
      const l = side === "out" ? lineOf(fromId, over.id) : lineOf(over.id, fromId);
      if (l) return { d: curvePath(l.a, l.b, l.back), bad: false };
    }
    const own = portAt(fromId, side);
    if (!own) return null;
    return { d: side === "out" ? curvePath(own, linking.to) : curvePath(linking.to, own), bad: !!problem };
  })();
  const quoted = (id: number) => `「${clip(byId.get(id)?.title ?? "")}」`;
  /** What letting go of the line being drawn does, said by the pointer. */
  const linkHint = (() => {
    if (!linking) return null;
    const { fromId, side, problems } = linking.view;
    const over = linking.over;
    if (over) {
      const problem = problems.get(over.id);
      if (problem) return { text: `不能连这两条：${problem}`, bad: true };
      const [first, then] = side === "out" ? [fromId, over.id] : [over.id, fromId];
      return { text: `松手：${quoted(then)}等${quoted(first)}做完`, bad: false };
    }
    if (linking.blank) return null;
    return { text: side === "out" ? "拖到另一条上：那条等这条做完" : "拖到另一条上：这条等那条做完", bad: false };
  })();
  const dot = v
    ? (() => {
        let step = DOT_STEP * v.zoom;
        while (step < 12) step *= 2;
        return step;
      })()
    : DOT_STEP;

  const empty = shown.length === 0;
  const hiddenDone = !showDone && items.some((i) => i.status === "done" && matchesFilters(i, "all", moduleFilter) && !linked.has(i.id));
  const nextUndo = history.past.at(-1);
  const nextRedo = history.future.at(-1);
  const menuLine = menu?.kind === "edge" ? (menu.key.split(">").map(Number) as [number, number]) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FlowToolbar
        showDone={showDone}
        canTidy={cards.roots.length > 1}
        undoLabel={nextUndo ? stepLabel(nextUndo.step) : ""}
        redoLabel={nextRedo ? stepLabel(nextRedo.step) : ""}
        onTidy={tidy}
        onUndo={() => void travel(true)}
        onRedo={() => void travel(false)}
        onAdd={() => openDraft(centerPoint())}
      />
      <ContextMenu>
        <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
          <div
            ref={box}
            tabIndex={-1}
            onPointerDown={onPointerDown}
            onPointerOver={(e) => {
              const card = (e.target as Element).closest<HTMLElement>("[data-flow-node]");
              setHoverCard(card ? Number(card.dataset.id) : 0);
            }}
            onPointerLeave={() => setHoverCard(0)}
            onDoubleClick={(e) => {
              // The pointer was captured: what is under it, not the event's target.
              const t = document.elementFromPoint(e.clientX, e.clientY);
              if (!v || !t || t.closest("[data-flow-control], [data-flow-edge], button")) return;
              const node = t.closest<HTMLElement>("[data-flow-node]");
              if (node) {
                const row = t.closest<HTMLElement>("[data-flow-item]");
                select(Number(row?.dataset.id ?? node.dataset.id));
                editTitle();
                return;
              }
              openDraft(toChart(v, local(e)));
            }}
            className={cn(
              "flow-board @container/board relative min-h-0 flex-1 overflow-hidden outline-none",
              panning && "cursor-grabbing",
              linking && "cursor-crosshair",
            )}
            style={v ? { backgroundSize: `${dot}px ${dot}px`, backgroundPosition: `${v.x}px ${v.y}px` } : undefined}
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
                      <marker id="flow-arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                        <path d="M 0 1 L 9 5 L 0 9 z" className="fill-destructive" />
                      </marker>
                    </defs>
                    <g transform={`translate(${-svgBox.x} ${-svgBox.y})`}>
                      {lines.map((l) => {
                        if (!l) return null;
                        const d = curvePath(l.a, l.b, l.back);
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
                                l.lit && "flow-edge-lit",
                                !l.waiting && l.lit && "stroke-muted-foreground",
                                on && "stroke-primary",
                                l.key === edge && "flow-edge-selected",
                              )}
                            />
                          </g>
                        );
                      })}
                      {drawn && (
                        <path
                          d={drawn.d}
                          fill="none"
                          markerEnd={`url(#${drawn.bad ? "flow-arrow-bad" : "flow-arrow-on"})`}
                          className={cn("flow-edge flow-edge-selected", drawn.bad ? "stroke-destructive" : "stroke-primary")}
                        />
                      )}
                    </g>
                  </svg>
                )}
                {cards.roots.map((root) => {
                  const p = placeOf(root);
                  const item = byId.get(root);
                  if (!p || !item) return null;
                  const rows = rowsOf.get(root) ?? [];
                  const own = [root, ...rows.map((r) => r.item.id)];
                  const node = forest.byId.get(root);
                  const done = node && node.children.length ? progress(node) : null;
                  const parent = item.parentId ? (byId.get(item.parentId)?.title ?? "") : "";
                  return (
                    <FlowCard
                      key={root}
                      root={item}
                      rows={rows}
                      x={p.x}
                      y={p.y}
                      height={heightOf(root)}
                      selected={own.filter((id) => selectedIds.has(id)).join(",")}
                      focus={selectedIds.size > 1 && own.includes(selectedId) ? selectedId : 0}
                      waits={waits}
                      parent={parent}
                      module={moduleFilter === "all" ? (moduleNames.get(item.moduleId) ?? "") : ""}
                      progress={done ? `${done.done}/${done.total}` : ""}
                      link={linking?.view ?? null}
                      over={linking?.over && own.includes(linking.over.id) ? linking.over.id : 0}
                      dragging={!!drag?.has(root)}
                    />
                  );
                })}
                {guides && (
                  <>
                    {guides.x !== null && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute bg-primary/70"
                        style={{ left: guides.x, top: -20_000, height: 40_000, width: 1 / v.zoom }}
                      />
                    )}
                    {guides.y !== null && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute bg-primary/70"
                        style={{ top: guides.y, left: -20_000, width: 40_000, height: 1 / v.zoom }}
                      />
                    )}
                  </>
                )}
                {linking?.blank && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute top-0 left-0 grid place-items-center rounded-lg border-2 border-dashed border-primary/60 bg-primary/5 text-xs text-primary"
                    style={{
                      transform: `translate(${linking.view.side === "out" ? linking.to.x : linking.to.x - NODE_WIDTH}px, ${linking.to.y - NODE_HEIGHT / 2}px)`,
                      width: NODE_WIDTH,
                      height: NODE_HEIGHT,
                    }}
                  >
                    松手在这里新建一条，自动连上
                  </div>
                )}
                {middle && !linking && (
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
            {v && linking && linkHint && (
              <div
                aria-hidden
                className={cn(
                  "pointer-events-none absolute z-30 max-w-72 truncate rounded-md border bg-popover px-2 py-1 text-xs shadow-md",
                  linkHint.bad ? "border-destructive/50 text-destructive" : "text-popover-foreground",
                )}
                style={{ left: toScreen(v, linking.to).x + 14, top: toScreen(v, linking.to).y + 16 }}
              >
                {linkHint.text}
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
            <FlowHints />
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
        </ContextMenuTrigger>
        <ContextMenuContent
          className="w-56"
          // Out in a portal, its events still bubble through React to the board.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => {
            const then = afterMenu.current;
            afterMenu.current = null;
            if (!then) return;
            e.preventDefault();
            then();
          }}
        >
          {menu?.kind === "edge" && menuLine ? (
            <>
              <ContextMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                {clip(byId.get(menuLine[0])?.title ?? "")} → {clip(byId.get(menuLine[1])?.title ?? "")}
              </ContextMenuLabel>
              <ContextMenuItem variant="destructive" onSelect={() => unlink(menu.key)}>
                <Trash2 />
                删除这条前置关系
                <ContextMenuShortcut>Delete</ContextMenuShortcut>
              </ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem
                onSelect={() => {
                  if (menu?.kind !== "pane") return;
                  const at = menu.at;
                  afterMenu.current = () => openDraft(at);
                }}
              >
                <Plus />
                在这里新建一条
                <ContextMenuShortcut>双击</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem disabled={empty} onSelect={selectAll}>
                <SquareDashedMousePointer />
                全选
                <ContextMenuShortcut>Ctrl+A</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={!nextUndo} onSelect={() => void travel(true)}>
                <Undo2 />
                {nextUndo ? `撤回「${stepLabel(nextUndo.step)}」` : "撤回"}
                <ContextMenuShortcut>Ctrl+Z</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem disabled={!nextRedo} onSelect={() => void travel(false)}>
                <Redo2 />
                {nextRedo ? `重做「${stepLabel(nextRedo.step)}」` : "重做"}
                <ContextMenuShortcut>Ctrl+Y</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={cards.roots.length < 2} onSelect={tidy}>
                <Network />
                一键整理
              </ContextMenuItem>
              <ContextMenuItem disabled={empty} onSelect={() => setView(fitAll())}>
                <Scan />
                显示全部
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

/** A button of the toolbar: an icon and what it does, with its key in a tooltip. */
function ToolButton({
  icon,
  label,
  tip,
  disabled,
  pressed,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  tip: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick(): void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          className={cn("text-muted-foreground", pressed && "bg-muted text-foreground")}
        >
          {icon}
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

/** The toolbar over the chart: adding, tidying, undoing, redoing; done ones or not. */
function FlowToolbar({
  showDone,
  canTidy,
  undoLabel,
  redoLabel,
  onTidy,
  onUndo,
  onRedo,
  onAdd,
}: {
  showDone: boolean;
  canTidy: boolean;
  /** What undoing and redoing would do, "" for nothing. */
  undoLabel: string;
  redoLabel: string;
  onTidy(): void;
  onUndo(): void;
  onRedo(): void;
  onAdd(): void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2 [scrollbar-width:none]">
      <ToolButton icon={<Plus />} label="新建" tip="在画布中间新建一条（N，或双击空白处）" onClick={onAdd} />
      <ToolButton icon={<Network />} label="一键整理" tip="按前后关系从左到右排好" disabled={!canTidy} onClick={onTidy} />
      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
      <ToolButton icon={<Undo2 />} label="撤回" tip={undoLabel ? `撤回「${undoLabel}」（Ctrl+Z）` : "撤回（Ctrl+Z）"} disabled={!undoLabel} onClick={onUndo} />
      <ToolButton icon={<Redo2 />} label="重做" tip={redoLabel ? `重做「${redoLabel}」（Ctrl+Y）` : "重做（Ctrl+Y）"} disabled={!redoLabel} onClick={onRedo} />
      <div className="ml-auto pl-2">
        <ToolButton
          icon={showDone ? <Eye /> : <EyeOff />}
          label="显示已完成"
          tip={showDone ? "隐藏已完成的（连着线的仍显示）" : "显示已完成的"}
          pressed={showDone}
          onClick={() => setShowDone(!showDone)}
        />
      </div>
    </div>
  );
}

/** A mouse, its left or right button or wheel in the accent color. */
function MouseGlyph({ part }: { part: "left" | "right" | "wheel" }) {
  return (
    <svg viewBox="0 0 14 20" className="h-3.5 w-2.5" aria-hidden>
      {part === "left" && <path d="M7 1.7A5.3 5.3 0 0 0 1.7 7V8.2H7Z" fill="var(--primary)" />}
      {part === "right" && <path d="M7 1.7A5.3 5.3 0 0 1 12.3 7V8.2H7Z" fill="var(--primary)" />}
      <rect x="1" y="1" width="12" height="18" rx="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.5 8.2H12.5M7 1.5V8.2" stroke="currentColor" strokeWidth="1.2" />
      {part === "wheel" && <rect x="5.4" y="2.6" width="3.2" height="4.4" rx="1.6" fill="var(--primary)" />}
    </svg>
  );
}

const dragGlyph = <Move className="size-2.5" aria-hidden />;
const keyCap = "h-5 min-w-5 gap-0.5 border border-b-2 bg-background px-1 text-[11px] font-semibold text-foreground shadow-xs";

/** The board's mouse moves and keys, a few words each. */
const HINTS: { id: string; keys: { label: string; glyph?: ReactNode }[]; text: string }[] = [
  { id: "select", keys: [{ label: "左键拖空白处", glyph: [<MouseGlyph key="m" part="left" />, dragGlyph] }], text: "框选" },
  { id: "add", keys: [{ label: "Ctrl" }, { label: "左键", glyph: <MouseGlyph part="left" /> }], text: "加选" },
  { id: "pan", keys: [{ label: "右键拖动", glyph: [<MouseGlyph key="m" part="right" />, dragGlyph] }], text: "平移" },
  { id: "menu", keys: [{ label: "右键", glyph: <MouseGlyph part="right" /> }], text: "菜单" },
  { id: "zoom", keys: [{ label: "滚轮", glyph: <MouseGlyph part="wheel" /> }], text: "缩放" },
  {
    id: "link",
    keys: [{ label: "拖圆点", glyph: [<span key="d" className="size-2 rounded-full border-[1.5px] border-primary" />, dragGlyph] }],
    text: "连线",
  },
  { id: "new", keys: [{ label: "N" }], text: "新建" },
  { id: "delete", keys: [{ label: "Delete", glyph: "Del" }], text: "删除" },
  { id: "undo", keys: [{ label: "Ctrl" }, { label: "Z" }], text: "撤回" },
  { id: "redo", keys: [{ label: "Ctrl" }, { label: "Y" }], text: "重做" },
];

/** Bottom left of the chart: what the mouse and the keys do, folded into a button when not wanted (kept on this machine). */
function FlowHints() {
  const open = useFlow((s) => s.hintsOpen);
  return (
    <div data-flow-control="" className="absolute bottom-3 left-3 hidden @min-[560px]/board:block">
      {open ? (
        <div className="animate-in rounded-lg border bg-popover/95 shadow-sm backdrop-blur-sm duration-150 fade-in-0 slide-in-from-bottom-1">
          <div className="flex items-center justify-between gap-2 border-b py-0.5 pr-0.5 pl-2.5">
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <Keyboard className="size-3.5 text-muted-foreground" />
              操作
            </span>
            <IconButton label="收起操作说明" size="icon-xs" className="text-muted-foreground" onClick={() => setHintsOpen(false)}>
              <ChevronDown />
            </IconButton>
          </div>
          <ul aria-label="操作说明" className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-2.5 py-2 text-xs">
            {HINTS.map((hint) => (
              <li key={hint.id} className="flex items-center gap-1.5">
                <span className="flex items-center gap-0.5">
                  {hint.keys.map((k) => (
                    <Kbd key={k.label} className={keyCap}>
                      {k.glyph ?? k.label}
                      {k.glyph && <span className="sr-only">{k.label}</span>}
                    </Kbd>
                  ))}
                </span>
                <span className="text-foreground/80">{hint.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Button variant="ghost" size="sm" className="border bg-popover/95 text-muted-foreground shadow-sm" onClick={() => setHintsOpen(true)}>
          <Keyboard />
          操作说明
        </Button>
      )}
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
      className="absolute top-0 left-0 flex flex-col justify-center gap-1 rounded-lg border border-dashed border-primary bg-card px-2.5 py-2 shadow-lg ring-3 ring-ring/30"
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
