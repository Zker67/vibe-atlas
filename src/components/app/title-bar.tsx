import { Monitor, Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";
import { Atlas, type Theme } from "@/mygo";
import { run } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAtlas } from "@/state/atlas";
import { toggleSidebar, useSidebar } from "@/state/sidebar";
import { IconButton } from "./icon-button";
import { OrgSwitcher } from "./org-switcher";

/**
 * The main window's one bar at the top: the window's title bar (the
 * window hides its own, keeping the window buttons, which sit over the
 * right end): the organization open, which switches to another, over the
 * sidebar, the button that folds the sidebar at its edge, and the
 * appearance. The open project's controls are atop the queue column. Its
 * empty parts drag the window; a double click maximizes it.
 */
export function TitleBar() {
  const collapsed = useSidebar((s) => s.collapsed);
  return (
    <header data-titlebar className="titlebar app-frame flex shrink-0 items-center text-sidebar-foreground">
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 self-stretch overflow-hidden whitespace-nowrap transition-[width,padding] duration-200 ease-out motion-reduce:transition-none",
          collapsed ? "w-14 justify-center px-0" : "w-60 px-3",
        )}
      >
        <OrgSwitcher />
        {/* Open, the button sits at the sidebar's right end; folded, just past the rail. */}
        {!collapsed && <SidebarButton className="-mr-1.5 ml-auto" />}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-between px-2">
        {collapsed ? <SidebarButton /> : <span />}
        <ThemeButton />
      </div>
    </header>
  );
}

/** Folds the sidebar into a rail of icons, or opens it again. */
function SidebarButton({ className }: { className?: string }) {
  const collapsed = useSidebar((s) => s.collapsed);
  return (
    <IconButton label={collapsed ? "展开侧栏" : "收起侧栏"} shortcut="Ctrl+\" className={className} onClick={toggleSidebar}>
      {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
    </IconButton>
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
