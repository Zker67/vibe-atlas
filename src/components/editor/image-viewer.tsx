// The large view of a note's pictures, over the whole window: the wheel
// zooms where the pointer is, dragging moves the picture, a double click
// switches between fitting the window and the actual size, ← → page
// through the note's pictures. The controls sit at the bottom, clear of
// the title bar, which drags the window.

import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { ChevronLeft, ChevronRight, ExternalLink, type LucideIcon, Maximize2, Minimize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { run } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Atlas } from "@/mygo";

let opened = false;

/**
 * Shows the picture names[index] large, the others a key away. In quick
 * capture, whose panel is small, the system's viewer opens it instead.
 */
export function openImageViewer(names: string[], index: number, base: string) {
  const name = names[index];
  if (!name || opened) return;
  if (document.documentElement.hasAttribute("data-capture")) {
    void run(Atlas.openImage(name));
    return;
  }
  opened = true;
  const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const closed = () => {
    root.unmount();
    host.remove();
    opened = false;
    restore?.focus({ preventScroll: true });
  };
  root.render(<ImageViewer names={names} start={index} base={base} onClosed={closed} />);
}

/** Room kept clear: the title bar above, the controls below. */
const TOP = 52;
const BOTTOM = 88;
const SIDE = 72;
const MAX_SCALE = 8;

interface View {
  scale: number;
  x: number;
  y: number;
  /** Whether the change animates: not while wheeling or dragging. */
  smooth: boolean;
}

function fitScale(w: number, h: number): number {
  const width = Math.max(120, window.innerWidth - SIDE * 2);
  const height = Math.max(120, window.innerHeight - TOP - BOTTOM);
  return Math.min(1, width / w, height / h);
}

function ImageViewer({ names, start, base, onClosed }: { names: string[]; start: number; base: string; onClosed(): void }) {
  const [index, setIndex] = useState(start);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0, smooth: false });
  const [closing, setClosing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const name = names[index]!;
  const fit = natural ? fitScale(natural.w, natural.h) : 1;
  const fitting = Math.abs(view.scale - fit) < 0.001 && view.x === 0 && view.y === 0;

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(onClosed, 170);
  }, [onClosed]);

  const go = useCallback(
    (step: number) => {
      if (names.length < 2) return;
      setNatural(null);
      setIndex((i) => (i + step + names.length) % names.length);
    },
    [names.length],
  );

  /**
   * Zooms to the scale target gives for the current one, keeping the
   * point (px, py) from the center where it is.
   */
  const zoom = useCallback(
    (target: (scale: number) => number, px = 0, py = 0, smooth = true) => {
      const min = Math.min(fit, 1) * 0.25;
      setView((v) => {
        const next = Math.min(MAX_SCALE, Math.max(min, target(v.scale)));
        const k = next / v.scale;
        return { scale: next, x: px - (px - v.x) * k, y: py - (py - v.y) * k, smooth };
      });
    },
    [fit],
  );
  const zoomTo = useCallback((scale: number, px = 0, py = 0) => zoom(() => scale, px, py), [zoom]);

  const reset = useCallback(() => setView({ scale: fit, x: 0, y: 0, smooth: true }), [fit]);

  // The window resizing fits the picture again.
  useEffect(() => {
    const onResize = () => natural && setView({ scale: fitScale(natural.w, natural.h), x: 0, y: 0, smooth: false });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [natural]);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // Keys go to the viewer alone while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      switch (e.key) {
        case "Escape":
          close();
          break;
        case "ArrowLeft":
          go(-1);
          break;
        case "ArrowRight":
          go(1);
          break;
        case "+":
        case "=":
          zoom((s) => s * 1.25);
          break;
        case "-":
          zoom((s) => s / 1.25);
          break;
        case "0":
          reset();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, go, zoom, reset]);

  // The wheel zooms where the pointer is; passive listeners cannot keep the page from scrolling.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = center();
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoom((s) => s * factor, e.clientX - c.x, e.clientY - c.y, false);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoom]);

  const drag = useRef<{ id: number; x: number; y: number; moved: boolean; onImage: boolean } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, onImage: e.target instanceof HTMLImageElement };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy, smooth: false }));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    // A click beside the picture closes the viewer.
    if (d && d.id === e.pointerId && !d.moved && !d.onImage) close();
  };
  const onDoubleClick = (e: ReactMouseEvent) => {
    if (!(e.target instanceof HTMLImageElement)) return;
    if (fitting) {
      const c = center();
      zoomTo(fit === 1 ? 2 : 1, e.clientX - c.x, e.clientY - c.y);
    } else {
      reset();
    }
  };

  const c = center();
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      data-closing={closing ? "" : undefined}
      className="image-viewer fixed inset-0 z-[100] outline-none select-none"
      style={{ "--app-region": "no-drag" } as CSSProperties}
    >
      <div className="image-viewer-backdrop absolute inset-0" />
      <div
        ref={stageRef}
        className="absolute inset-0 cursor-grab overflow-hidden active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={onDoubleClick}
      >
        <img
          key={name}
          src={base + name}
          alt=""
          draggable={false}
          data-ready={natural ? "" : undefined}
          className="image-viewer-img absolute max-w-none"
          style={{
            left: c.x,
            top: c.y,
            width: natural?.w,
            height: natural?.h,
            transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: view.smooth ? "transform 260ms var(--spring-pop)" : "none",
          }}
          onLoad={(e) => {
            // It starts fitted, in the same render that shows it.
            const w = e.currentTarget.naturalWidth;
            const h = e.currentTarget.naturalHeight;
            setNatural({ w, h });
            setView({ scale: fitScale(w, h), x: 0, y: 0, smooth: false });
          }}
        />
      </div>

      {names.length > 1 && (
        <>
          <SideButton icon={ChevronLeft} label="上一张" keys="←" className="left-4" onClick={() => go(-1)} />
          <SideButton icon={ChevronRight} label="下一张" keys="→" className="right-4" onClick={() => go(1)} />
        </>
      )}

      <div role="toolbar" aria-label="预览" className="image-viewer-bar absolute bottom-5 left-1/2 flex items-center gap-0.5 p-1.5">
        {names.length > 1 && (
          <>
            <span className="px-2.5 text-xs text-white/65 tabular-nums">
              {index + 1} / {names.length}
            </span>
            <BarDivider />
          </>
        )}
        <BarButton icon={ZoomOut} label="缩小" keys="-" onClick={() => zoom((s) => s / 1.25)} />
        <button
          type="button"
          className="viewer-button w-14 justify-center text-xs tabular-nums"
          title="在适应窗口和原始大小之间切换"
          onClick={() => (fitting ? zoomTo(1) : reset())}
        >
          {Math.round(view.scale * 100)}%
        </button>
        <BarButton icon={ZoomIn} label="放大" keys="+" onClick={() => zoom((s) => s * 1.25)} />
        <BarButton
          icon={fitting ? Maximize2 : Minimize2}
          label={fitting ? "原始大小" : "适应窗口"}
          keys={fitting ? undefined : "0"}
          text
          onClick={() => (fitting ? zoomTo(1) : reset())}
        />
        <BarDivider />
        <BarButton icon={ExternalLink} label="用默认应用打开" text onClick={() => void run(Atlas.openImage(name))} />
        <BarDivider />
        <BarButton icon={X} label="关闭" keys="Esc" onClick={close} />
      </div>
    </div>
  );
}

/** The middle of the room the picture has. */
function center() {
  return { x: window.innerWidth / 2, y: (TOP + window.innerHeight - BOTTOM) / 2 };
}

function BarDivider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />;
}

function BarButton({
  icon: Icon,
  label,
  keys,
  text,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  keys?: string;
  text?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={keys ? `${label}（${keys}）` : label}
      className={cn("viewer-button group", text ? "gap-1.5 px-2.5" : "w-8 justify-center")}
      onClick={onClick}
    >
      <Icon className="viewer-icon size-4" />
      {text && <span className="text-xs">{label}</span>}
    </button>
  );
}

function SideButton({
  icon: Icon,
  label,
  keys,
  className,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  keys: string;
  className: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label}（${keys}）`}
      className={cn("image-viewer-side absolute top-1/2 grid size-11 place-items-center rounded-full", className)}
      onClick={onClick}
    >
      <Icon className="size-5" />
    </button>
  );
}
