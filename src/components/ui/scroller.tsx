import { useEffect, useRef, type ComponentProps, type Ref } from "react";
import { cn } from "cn";

/**
 * A box that scrolls up and down with a scroll bar of the app's own: a thin
 * thumb over the content, which shows while it scrolls or the pointer is on
 * it, fades once it stops, widens under the pointer, and can be dragged; a
 * click on its track pages. The content scrolls natively, so the wheel, the
 * keys, dragging into the edges and scrollIntoView work as ever.
 *
 * className lays the box out (min-h-0 flex-1, …); viewportClassName, with
 * the props, goes to the element that scrolls, which ref gets. With always,
 * the bar stays in sight, over a faint track, whenever the box scrolls: for
 * long reads, where it tells there is more and how much.
 */
export function Scroller({
  className,
  viewportClassName,
  always = false,
  children,
  ref,
  ...props
}: ComponentProps<"div"> & { viewportClassName?: string; always?: boolean; ref?: Ref<HTMLDivElement> }) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);

  const setViewport = (el: HTMLDivElement | null) => {
    viewport.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };

  useEffect(() => {
    const v = viewport.current;
    const b = bar.current;
    const t = thumb.current;
    if (!v || !b || !t) return;

    let frame = 0;
    let fade = 0;
    // The thumb's size and place, in px, as last drawn.
    let size = 0;
    let room = 0;

    const draw = () => {
      frame = 0;
      const { scrollTop, scrollHeight, clientHeight } = v;
      const track = b.clientHeight;
      const scrolls = scrollHeight > clientHeight + 1 && track > 0;
      b.toggleAttribute("data-hidden", !scrolls);
      if (!scrolls) return;
      size = Math.max(24, (track * clientHeight) / scrollHeight);
      room = track - size;
      const y = (room * scrollTop) / (scrollHeight - clientHeight);
      t.style.height = `${size}px`;
      t.style.transform = `translateY(${y}px)`;
    };
    const update = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    /** Shows the bar, which fades once nothing moves it. */
    const show = () => {
      update();
      b.setAttribute("data-active", "");
      window.clearTimeout(fade);
      fade = window.setTimeout(() => b.removeAttribute("data-active"), 900);
    };

    // The content grows and shrinks: watch the box and what is in it.
    const sizes = new ResizeObserver(update);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(v);
      for (const child of v.children) sizes.observe(child);
      update();
    };
    const added = new MutationObserver(watch);
    added.observe(v, { childList: true });
    watch();

    const root = v.parentElement!;
    v.addEventListener("scroll", show, { passive: true });
    root.addEventListener("pointerenter", show);

    // Dragging the thumb scrolls in step with the pointer.
    let drag: { y: number; top: number; id: number } | null = null;
    const onThumbDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      drag = { y: e.clientY, top: v.scrollTop, id: e.pointerId };
      t.setPointerCapture(e.pointerId);
      b.setAttribute("data-dragging", "");
    };
    const onThumbMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id || room <= 0) return;
      v.scrollTop = drag.top + ((e.clientY - drag.y) * (v.scrollHeight - v.clientHeight)) / room;
    };
    const onThumbUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      b.removeAttribute("data-dragging");
      show();
    };
    // A click on the track pages towards it.
    const onTrackDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.target === t) return;
      e.preventDefault();
      const above = e.clientY < t.getBoundingClientRect().top;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      v.scrollBy({ top: (above ? -1 : 1) * v.clientHeight * 0.9, behavior: reduce ? "auto" : "smooth" });
    };
    t.addEventListener("pointerdown", onThumbDown);
    t.addEventListener("pointermove", onThumbMove);
    t.addEventListener("pointerup", onThumbUp);
    t.addEventListener("pointercancel", onThumbUp);
    b.addEventListener("pointerdown", onTrackDown);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(fade);
      sizes.disconnect();
      added.disconnect();
      v.removeEventListener("scroll", show);
      root.removeEventListener("pointerenter", show);
      t.removeEventListener("pointerdown", onThumbDown);
      t.removeEventListener("pointermove", onThumbMove);
      t.removeEventListener("pointerup", onThumbUp);
      t.removeEventListener("pointercancel", onThumbUp);
      b.removeEventListener("pointerdown", onTrackDown);
    };
  }, []);

  return (
    <div data-slot="scroller" className={cn("relative flex min-h-0 flex-col", className)}>
      <div ref={setViewport} className={cn("scroller-viewport min-h-0 flex-1 overflow-y-auto", viewportClassName)} {...props}>
        {children}
      </div>
      <div ref={bar} aria-hidden className="scroller-bar" data-hidden="" data-always={always ? "" : undefined}>
        <div ref={thumb} className="scroller-thumb" />
      </div>
    </div>
  );
}
