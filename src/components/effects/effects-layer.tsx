import { Component, lazy, Suspense, useSyncExternalStore, type ReactNode } from "react";
import type { Background, Wallpaper } from "@/mygo";
import { useIsDark } from "@/lib/theme";
import { useAtlas } from "@/state/atlas";
import { wallpaperShown } from "@/lib/look";

// Each background is a chunk of its own: only the one picked loads.
const DotGrid = lazy(() => import("@/components/react-bits/DotGrid"));
const PatternWaves = lazy(() => import("@/components/react-bits/PatternWaves"));

/**
 * The background is decoration: when its chunk fails to load or its
 * shader throws, it hides, and the app goes on. Keyed by the background,
 * so that picking another one tries again.
 */
class BackgroundBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[effects] 动态背景加载失败，已隐藏：", error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)");

function subscribeMotion(onChange: () => void) {
  const q = reducedMotion();
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
}

/** Whether the system asks for less motion: the backgrounds then stand still. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => reducedMotion().matches);
}

// Monochrome, as the app's icon: the ink of the theme, never a type's color.
// The grounds are --background in src/index.css.
const GROUND = { dark: "#020202", light: "#f4f3f1" };

function MovingBackground({ id, dark, still, over }: { id: Background; dark: boolean; still: boolean; over: boolean }) {
  if (id === "waves") {
    return (
      <PatternWaves
        preset="terminal"
        direction={90}
        scale={1.4}
        speed={1.05}
        fade="none"
        color={dark ? "#d4d4d8" : "#3f3f46"}
        // Over a picture, a ground of 3 %: the waves pick how to draw (glow or
        // ink) by how light their ground is, which a clear one would not tell.
        backgroundColor={over ? (dark ? "rgba(2, 2, 2, 0.03)" : "rgba(244, 243, 241, 0.03)") : dark ? GROUND.dark : GROUND.light}
        opacity={dark ? 0.55 : 0.6}
        cursorStrength={0.5}
        paused={still}
      />
    );
  }
  return (
    <DotGrid
      dotSize={3}
      gap={14}
      baseColor={dark ? "#1f1f23" : "#dddcd6"}
      activeColor={dark ? "#e4e4e7" : "#27272a"}
      proximity={160}
      glow={0.5}
      fade={0.25}
      paused={still}
    />
  );
}

/** The user's picture, placed, blurred and faded as they set. */
function WallpaperImage({ wallpaper }: { wallpaper: Wallpaper }) {
  const { blur, opacity, scale, x, y } = wallpaper.look;
  return (
    <div
      aria-hidden
      data-wallpaper-layer=""
      className="pointer-events-none fixed inset-0 -z-10 bg-no-repeat"
      style={{
        backgroundImage: `url("${wallpaper.url}")`,
        backgroundSize: scale === 0 ? "cover" : `${scale}%`,
        backgroundPosition: `${x}% ${y}%`,
        opacity: opacity / 100,
        filter: blur ? `blur(${blur}px)` : undefined,
        // A blur fades the edges in: grow a little to hide them.
        transform: blur ? "scale(1.05)" : undefined,
      }}
    />
  );
}

/**
 * What is behind the main window: the user's picture, if shown, and over
 * it the moving background, while the effects are on. The CSS effects
 * (frosted glass, glowing rows) key on html[data-effects], which the main
 * window sets while either shows.
 */
export default function EffectsLayer() {
  const effects = useAtlas((s) => s.settings?.effects ?? false);
  const id = useAtlas((s) => s.settings?.background ?? "grid");
  const wallpaper = useAtlas((s) => s.settings?.wallpaper);
  const dark = useIsDark();
  const still = useReducedMotion();
  const picture = wallpaper && wallpaperShown(wallpaper) ? wallpaper : null;
  return (
    <>
      {picture && <WallpaperImage wallpaper={picture} />}
      {/* Also -z-10, and after the picture: drawn over it. */}
      {effects && (
        <div aria-hidden data-effects-layer={id} className="pointer-events-none fixed inset-0 -z-10">
          <BackgroundBoundary key={id}>
            <Suspense fallback={null}>
              <MovingBackground id={id} dark={dark} still={still} over={!!picture} />
            </Suspense>
          </BackgroundBoundary>
        </div>
      )}
    </>
  );
}
