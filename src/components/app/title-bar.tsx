import { Monitor, Moon, Sun } from "lucide-react";
import { Atlas, type Theme } from "@/mygo";
import { run } from "@/lib/api";
import { useAtlas } from "@/state/atlas";
import appIcon from "@/assets/app-icon.png";
import { IconButton } from "./icon-button";

/**
 * The main window's one bar at the top: the window's title bar (the
 * window hides its own, keeping the window buttons, which sit over the
 * right end): the app's icon and name over the sidebar, and the
 * appearance. The open project's controls are atop the queue column.
 * Its empty parts drag the window; a double click maximizes it.
 */
export function TitleBar() {
  return (
    <header data-titlebar className="titlebar app-frame flex shrink-0 items-center text-sidebar-foreground">
      <div className="flex w-60 shrink-0 items-center gap-2 self-stretch px-3">
        <img src={appIcon} alt="" draggable={false} className="size-6 shrink-0" />
        <span className="font-semibold tracking-tight">Vibe Atlas</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end px-2">
        <ThemeButton />
      </div>
    </header>
  );
}

const THEME_CYCLE: { value: Theme; next: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", next: "light", label: "外观：跟随系统", icon: Monitor },
  { value: "light", next: "dark", label: "外观：浅色", icon: Sun },
  { value: "dark", next: "system", label: "外观：深色", icon: Moon },
];

/** Switches the appearance: 跟随系统 → 浅色 → 深色. */
function ThemeButton() {
  const theme = useAtlas((s) => s.settings?.theme);
  const at = THEME_CYCLE.find((t) => t.value === theme);
  if (!at) return null;
  return (
    <IconButton
      label={at.label}
      onClick={() => void run(Atlas.setTheme(at.next)).then((s) => s && useAtlas.setState({ settings: s }))}
    >
      <at.icon />
    </IconButton>
  );
}
