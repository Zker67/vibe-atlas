import type { Glass, Settings, Wallpaper } from "@/mygo";

/** Whether there is a picture behind the main window, and it shows. */
export function wallpaperShown(w: Wallpaper): boolean {
  return w.url !== "" && w.look.enabled;
}

/**
 * Whether something is behind the main window, a moving background or a
 * picture: then the frame and panel are frosted glass (html[data-effects]).
 */
export function decorated(s: Settings): boolean {
  return s.effects || wallpaperShown(s.wallpaper);
}

/** Sets the CSS variables of the frosted glass (src/index.css). */
export function applyGlass(g: Glass) {
  const style = document.documentElement.style;
  style.setProperty("--glass-blur", `${g.blur}px`);
  style.setProperty("--glass-panel", `${g.panel}%`);
  style.setProperty("--glass-frame", `${g.frame}%`);
}
