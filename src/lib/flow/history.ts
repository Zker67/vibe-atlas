// The flow chart's undo and redo: each step as a command that can be done
// the other way. Pure, for the tests; the chart runs the commands.

/** Where a card sits, as Go keeps it. */
export interface Spot {
  itemId: number;
  x: number;
  y: number;
}

/** A step on the chart: cards moved (from before to after, label saying how), a line drawn, a line taken away. */
export type FlowStep =
  | { kind: "place"; before: Spot[]; after: Spot[]; label?: string }
  | { kind: "link"; fromId: number; toId: number }
  | { kind: "unlink"; fromId: number; toId: number };

/** A step, and when it was made. */
export interface HistoryEntry {
  step: FlowStep;
  at: number;
}

export interface FlowHistory {
  /** The steps made, the last at the end. */
  past: HistoryEntry[];
  /** The steps undone, the last undone at the end. */
  future: HistoryEntry[];
}

export const EMPTY_HISTORY: FlowHistory = { past: [], future: [] };

/** How many steps the history keeps. */
export const HISTORY_LIMIT = 100;

/** The history after a new step: it goes last, and nothing is left to redo. */
export function record(h: FlowHistory, step: FlowStep, at: number): FlowHistory {
  return { past: [...h.past, { step, at }].slice(-HISTORY_LIMIT), future: [] };
}

/** What doing step the other way does. */
export function inverse(step: FlowStep): FlowStep {
  switch (step.kind) {
    case "place":
      return { kind: "place", before: step.after, after: step.before, ...(step.label ? { label: step.label } : {}) };
    case "link":
      return { kind: "unlink", fromId: step.fromId, toId: step.toId };
    case "unlink":
      return { kind: "link", fromId: step.fromId, toId: step.toId };
  }
}

/** What a step is called in the menus: 「撤回「移动」」. */
export function stepLabel(step: FlowStep): string {
  switch (step.kind) {
    case "place":
      return step.label ?? "移动";
    case "link":
      return "连线";
    case "unlink":
      return "删除连线";
  }
}

/** When the last step to undo was made, 0 for none. */
export function lastAt(h: FlowHistory): number {
  return h.past.at(-1)?.at ?? 0;
}

/**
 * The step undoing the last one runs (its inverse), and the history once it
 * ran, or once it failed (then the step is dropped: there is nothing left
 * to undo it on); null when there is nothing to undo.
 */
export function undoStep(h: FlowHistory): { run: FlowStep; done: FlowHistory; failed: FlowHistory } | null {
  const entry = h.past.at(-1);
  if (!entry) return null;
  const past = h.past.slice(0, -1);
  return { run: inverse(entry.step), done: { past, future: [...h.future, entry] }, failed: { past, future: h.future } };
}

/** As undoStep, for the last step undone: it runs again. */
export function redoStep(h: FlowHistory): { run: FlowStep; done: FlowHistory; failed: FlowHistory } | null {
  const entry = h.future.at(-1);
  if (!entry) return null;
  const future = h.future.slice(0, -1);
  return { run: entry.step, done: { past: [...h.past, entry], future }, failed: { past: h.past, future } };
}
