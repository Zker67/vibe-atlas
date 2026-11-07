import { Component, lazy, Suspense, useSyncExternalStore, type ReactNode } from "react";
import type { Background } from "@/mygo";
import { useIsDark } from "@/lib/theme";
import { useAtlas } from "@/state/atlas";

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

function MovingBackground({ id, dark, still }: { id: Background; dark: boolean; still: boolean }) {
  if (id === "waves") {
    return (
      <PatternWaves
        preset="terminal"
        direction={90}
        scale={1.4}
        speed={1.05}
        fade="none"
        color={dark ? "#d4d4d8" : "#3f3f46"}
        backgroundColor={dark ? GROUND.dark : GROUND.light}
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

/**
 * The moving background of the main window, behind everything, while the
 * effects are on. The CSS effects (blurred panels, glowing rows) key on
 * html[data-effects], which the main window sets.
 */
export default function EffectsLayer() {
  const id = useAtlas((s) => s.settings?.background ?? "grid");
  const dark = useIsDark();
  const still = useReducedMotion();
  return (
    <div aria-hidden data-effects-layer={id} className="pointer-events-none fixed inset-0 -z-10">
      <BackgroundBoundary key={id}>
        <Suspense fallback={null}>
          <MovingBackground id={id} dark={dark} still={still} />
        </Suspense>
      </BackgroundBoundary>
    </div>
  );
}
