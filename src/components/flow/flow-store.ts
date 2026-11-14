import { create } from "zustand";
import { Atlas } from "@/mygo";
import { runOk } from "@/lib/api";
import type { Point, Viewport } from "@/lib/flow/geometry";
import { EMPTY_HISTORY, type FlowHistory, type Spot } from "@/lib/flow/history";

// What the flow chart keeps besides the items and prerequisites of
// state/atlas.ts: where the cards are saved, the undo history, and the
// chart's own settings. Loaded with the chart, never by quick capture.

interface FlowState {
  /** The project whose places these are, 0 before they load. */
  projectId: number;
  /** Where the cards are saved; those without a place are laid out by the chart. */
  saved: ReadonlyMap<number, Point>;
  /** Whether saved was read for projectId (or reading it failed: the chart lays out all). */
  loaded: boolean;
  history: FlowHistory;
  /** Whether the chart shows done items without lines too; those with lines always show. */
  showDone: boolean;
  /** Whether the chart's panel of keys and mouse moves is open. */
  hintsOpen: boolean;
}

const SHOW_DONE_KEY = "vibe-atlas-flow-done";
const HINTS_KEY = "vibe-atlas-flow-hints";
const VIEWPORTS_KEY = "vibe-atlas-flow-viewports";

export const useFlow = create<FlowState>(() => ({
  projectId: 0,
  saved: new Map(),
  loaded: false,
  history: EMPTY_HISTORY,
  showDone: localStorage.getItem(SHOW_DONE_KEY) === "1",
  hintsOpen: localStorage.getItem(HINTS_KEY) !== "0",
}));

export function setShowDone(showDone: boolean) {
  useFlow.setState({ showDone });
  localStorage.setItem(SHOW_DONE_KEY, showDone ? "1" : "0");
}

export function setHintsOpen(hintsOpen: boolean) {
  useFlow.setState({ hintsOpen });
  localStorage.setItem(HINTS_KEY, hintsOpen ? "1" : "0");
}

export function setHistory(history: FlowHistory) {
  useFlow.setState({ history });
}

// Saves in flight, and whether a load came meanwhile: what a load reads
// then may miss them, so it runs again once they are done.
let writing = 0;
let writes = 0;
let loadAgain = 0;

/** Reads where the cards of a project are saved; another project starts a new history. */
export async function loadCanvas(projectId: number) {
  if (useFlow.getState().projectId !== projectId) {
    useFlow.setState({ projectId, saved: new Map(), loaded: false, history: EMPTY_HISTORY });
  }
  if (writing) {
    loadAgain = projectId;
    return;
  }
  const seen = writes;
  try {
    const spots = await Atlas.canvas(projectId);
    if (useFlow.getState().projectId !== projectId) return;
    if (writes !== seen) {
      // Saved meanwhile: read again, once saving is done.
      if (writing) loadAgain = projectId;
      else void loadCanvas(projectId);
      return;
    }
    useFlow.setState({ saved: new Map(spots.map((s) => [s.itemId, { x: s.x, y: s.y }])), loaded: true });
  } catch {
    // The chart lays the cards out by itself meanwhile.
    if (useFlow.getState().projectId === projectId) useFlow.setState({ loaded: true });
  }
}

/** Saves where cards go, showing them there at once; false after showing why it failed. */
export async function saveSpots(projectId: number, spots: Spot[]): Promise<boolean> {
  if (spots.length === 0) return true;
  if (useFlow.getState().projectId === projectId) {
    const saved = new Map(useFlow.getState().saved);
    for (const s of spots) saved.set(s.itemId, { x: s.x, y: s.y });
    useFlow.setState({ saved });
  }
  writing++;
  writes++;
  const ok = await runOk(Atlas.setCanvas(projectId, spots));
  writing--;
  if (!writing && loadAgain) {
    const id = loadAgain;
    loadAgain = 0;
    void loadCanvas(id);
  } else if (!ok) {
    void loadCanvas(projectId);
  }
  return ok;
}

/** Where the chart of each project was last panned and zoomed, kept on this machine. */
function viewports(): Record<string, Viewport> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(VIEWPORTS_KEY) ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, Viewport>) : {};
  } catch {
    return {};
  }
}

export function savedViewport(projectId: number): Viewport | null {
  const v = viewports()[String(projectId)];
  return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom) && v.zoom > 0 ? v : null;
}

export function saveViewport(projectId: number, v: Viewport) {
  const all = viewports();
  all[String(projectId)] = { x: Math.round(v.x), y: Math.round(v.y), zoom: Math.round(v.zoom * 1000) / 1000 };
  localStorage.setItem(VIEWPORTS_KEY, JSON.stringify(all));
}
