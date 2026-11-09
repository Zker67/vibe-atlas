import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";

// The motion of the main window, on the springs of index.css: a highlight
// that slides to the part picked, content that fades in as it changes, and
// rows that move to where they go. None of it plays when the system asks
// for less motion.

/** Whether the system asks for less motion. */
export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The spring that things settle on, as a CSS easing, and how long it takes. */
function spring(): { easing: string; duration: number } {
  const css = getComputedStyle(document.documentElement);
  const easing = css.getPropertyValue("--spring-pop").trim() || "cubic-bezier(0.2, 0.8, 0.2, 1)";
  const duration = parseFloat(css.getPropertyValue("--spring-pop-duration")) || 380;
  return { easing, duration };
}

/** Where el is within root, the element its offsets are measured from, transforms left out. */
function offsetIn(el: HTMLElement, root: Element | null): { left: number; top: number } {
  let left = 0;
  let top = 0;
  let at: HTMLElement | null = el;
  while (at && at !== root) {
    left += at.offsetLeft;
    top += at.offsetTop;
    at = at.offsetParent as HTMLElement | null;
  }
  return { left, top };
}

/** What marks the part picked, among the children of a Glide's parent. */
const PICKED = '[data-state="on"], [aria-pressed="true"], [aria-selected="true"], [data-state="active"], [data-active="true"]';

/** Where the Glides with a memory were last, to slide on from there when they show again. */
const glideMemory = new Map<string, { left: number; top: number; width: number; height: number }>();

/**
 * A highlight under the part picked of its parent, which slides to the one
 * picked now, taking its size, its corners and its --chip. It is the
 * parent's first child, and the parts are positioned (relative) so that
 * they show over it; the parent or one above it is positioned too. With no
 * part picked, it fades out. With a memory, a Glide shown again in another
 * place of the window, as the views switch, slides on from where the last
 * one of that memory was within its parent.
 */
export function Glide({ className, selector = PICKED, memory }: { className?: string; selector?: string; memory?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const glide = ref.current;
    const parent = glide?.parentElement;
    if (!glide || !parent) return;
    let shown = false;
    const place = () => {
      const picked = [...parent.querySelectorAll<HTMLElement>(selector)].find((el) => el !== glide);
      if (!picked || !picked.offsetParent) {
        glide.style.opacity = "0";
        shown = false;
        return;
      }
      const at = offsetIn(picked, glide.offsetParent);
      const style = getComputedStyle(picked);
      const was = !shown && memory ? glideMemory.get(memory) : undefined;
      if (memory) glideMemory.set(memory, { ...at, width: picked.offsetWidth, height: picked.offsetHeight });
      if (was && !reducedMotion()) {
        // Shown again: from where it was, at once, then on to where it goes.
        glide.style.transitionProperty = "none";
        glide.style.transform = `translate(${was.left}px, ${was.top}px)`;
        glide.style.width = `${was.width}px`;
        glide.style.height = `${was.height}px`;
        glide.style.opacity = "1";
        void glide.offsetWidth;
        glide.style.transitionProperty = "";
        shown = true;
      }
      // Appearing, it starts where the part is, and only fades in.
      if (!shown) glide.style.transitionProperty = "opacity";
      glide.style.transform = `translate(${at.left}px, ${at.top}px)`;
      glide.style.width = `${picked.offsetWidth}px`;
      glide.style.height = `${picked.offsetHeight}px`;
      glide.style.borderRadius = style.borderRadius;
      const chip = style.getPropertyValue("--chip");
      if (chip) glide.style.setProperty("--chip", chip);
      else glide.style.removeProperty("--chip");
      glide.style.opacity = "1";
      if (!shown) {
        void glide.offsetWidth; // apply the place before the transitions come back
        glide.style.transitionProperty = "";
        shown = true;
      }
    };
    place();
    const sizes = new ResizeObserver(place);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(parent);
      for (const child of parent.children) if (child !== glide) sizes.observe(child);
    };
    watch();
    const changes = new MutationObserver((records) => {
      if (records.some((r) => r.type === "childList")) watch();
      place();
    });
    changes.observe(parent, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state", "aria-pressed", "aria-selected", "data-active", "class"],
    });
    return () => {
      sizes.disconnect();
      changes.disconnect();
    };
  }, [selector, memory]);
  return (
    <span
      ref={ref}
      aria-hidden
      style={{ opacity: 0 }}
      className={cn(
        "pointer-events-none absolute top-0 left-0 transition-[transform,width,height,opacity,background-color,box-shadow,border-radius] duration-[var(--spring-pop-duration)] ease-[var(--spring-pop)] motion-reduce:transition-none",
        className,
      )}
    />
  );
}

/** Fades ref's element in each time key changes, not when it first shows. */
export function useEntrance(ref: RefObject<HTMLElement | null>, key: string) {
  const last = useRef(key);
  useLayoutEffect(() => {
    if (last.current === key) return;
    last.current = key;
    if (reducedMotion()) return;
    ref.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
  }, [ref, key]);
}

/** More rows than this moving or coming in at once is a new list, not a change to one. */
const MOVES_MAX = 120;
const ENTERS_MAX = 30;

/**
 * Moves the elements with data-flip under root from where they were to
 * where they are now after each render, and fades in those that were not
 * there. Each data-flip names one element, and they are not inside one
 * another. Nothing moves the first time, when scope changes (another
 * project, other filters), or while rows are dragged.
 */
export function useFlip(root: RefObject<HTMLElement | null>, scope: string) {
  const last = useRef<{ scope: string; at: Map<string, number> }>({ scope, at: new Map() });
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const nodes = [...el.querySelectorAll<HTMLElement>("[data-flip]")];
    const at = new Map(nodes.map((n) => [n.dataset.flip!, offsetIn(n, el).top]));
    const before = last.current;
    last.current = { scope, at };
    if (before.scope !== scope || before.at.size === 0) return;
    if (reducedMotion() || document.documentElement.classList.contains("dragging-rows")) return;

    // Where those gone were: one that comes in right there takes its place, as
    // the row added from the line being typed in, and shows at once.
    const gone = [...before.at].filter(([key]) => !at.has(key)).map(([, top]) => top);
    const moves: [HTMLElement, number][] = [];
    const enters: HTMLElement[] = [];
    for (const n of nodes) {
      const key = n.dataset.flip!;
      const to = at.get(key)!;
      const from = before.at.get(key);
      if (from === undefined) {
        if (!gone.some((top) => Math.abs(top - to) < 1)) enters.push(n);
      } else if (Math.abs(from - to) > 0.5) moves.push([n, from - to]);
    }
    if (moves.length > MOVES_MAX) return;
    const { easing, duration } = spring();
    for (const [n, dy] of moves) {
      n.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration, easing });
    }
    if (enters.length > ENTERS_MAX) return;
    for (const n of enters) {
      n.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "ease-out" });
    }
  });
}

/** Whether the value changed since the first render: from then on, what shows anew fades in. */
export function useChangedOnce(value: unknown): boolean {
  const [first] = useState(value);
  const [changed, setChanged] = useState(false);
  // Noted as it renders, so that the render that changes it already fades in; it only ever turns true.
  const now = changed || value !== first;
  if (now && !changed) setChanged(true);
  return now;
}
