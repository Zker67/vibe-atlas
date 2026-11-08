import { create } from "zustand";

// The immersive dialog of the notes: whether it is open, and how the user
// likes it, kept on this machine.

export type LineWidth = "narrow" | "medium" | "wide";

export interface ImmersivePrefs {
  /** Over the whole main window, rather than a dialog in it. */
  full: boolean;
  /** Dims all but the paragraph being written. */
  focus: boolean;
  /** Keeps the line being written in the middle. */
  typewriter: boolean;
  width: LineWidth;
  /** The size of the text, in pixels. */
  fontSize: number;
  /** Shows the outline beside the text. */
  outline: boolean;
}

interface ImmersiveState extends ImmersivePrefs {
  open: boolean;
  /**
   * Bumped as the dialog closes, once its notes are saved: the editor of
   * the detail panel starts over with them.
   */
  round: number;
}

const PREFS_KEY = "vibe-atlas-immersive";

export const FONT_SIZES = { min: 13, max: 22, step: 1 } as const;

const DEFAULTS: ImmersivePrefs = { full: false, focus: false, typewriter: false, width: "medium", fontSize: 15, outline: true };

function loadPrefs(): ImmersivePrefs {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    if (!saved || typeof saved !== "object") return DEFAULTS;
    const p = saved as Partial<Record<keyof ImmersivePrefs, unknown>>;
    return {
      full: typeof p.full === "boolean" ? p.full : DEFAULTS.full,
      focus: typeof p.focus === "boolean" ? p.focus : DEFAULTS.focus,
      typewriter: typeof p.typewriter === "boolean" ? p.typewriter : DEFAULTS.typewriter,
      width: p.width === "narrow" || p.width === "medium" || p.width === "wide" ? p.width : DEFAULTS.width,
      fontSize:
        typeof p.fontSize === "number" && p.fontSize >= FONT_SIZES.min && p.fontSize <= FONT_SIZES.max ? Math.round(p.fontSize) : DEFAULTS.fontSize,
      outline: typeof p.outline === "boolean" ? p.outline : DEFAULTS.outline,
    };
  } catch {
    return DEFAULTS;
  }
}

export const useImmersive = create<ImmersiveState>(() => ({ ...loadPrefs(), open: false, round: 0 }));

/** Changes how the dialog looks, and remembers it. */
export function setImmersivePrefs(patch: Partial<ImmersivePrefs>) {
  useImmersive.setState(patch);
  const { full, focus, typewriter, width, fontSize, outline } = useImmersive.getState();
  localStorage.setItem(PREFS_KEY, JSON.stringify({ full, focus, typewriter, width, fontSize, outline }));
}

/** Opens the dialog on the notes of the item selected. */
export function openImmersive() {
  useImmersive.setState({ open: true });
}

/** Closes the dialog; the detail panel's editor then starts over with the notes saved. */
export function closeImmersive() {
  useImmersive.setState((s) => ({ open: false, round: s.round + 1 }));
}
