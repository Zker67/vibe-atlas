import { lazy, Suspense, useEffect } from "react";
import { FolderKanban, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { useDefaultLayout } from "react-resizable-panels";
import { isComposing, isTypingTarget, overlayOpen } from "@/lib/keys";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialog, NameDialog } from "@/components/app/dialogs";
import { ItemDetail } from "@/components/app/item-detail";
import { Overview } from "@/components/app/overview";
import { ProjectBar, QueueFilters } from "@/components/app/project-header";
import { confirmDeleteItem, Queue, visibleItems } from "@/components/app/queue";
import { SettingsDialog } from "@/components/app/settings-dialog";
import { newProject, Sidebar } from "@/components/app/sidebar";
import { TitleBar } from "@/components/app/title-bar";
import {
  copyItem,
  focusNewItem,
  init,
  openDeeplink,
  refresh,
  select,
  toggleItemDoing,
  toggleItemDone,
  useAtlas,
} from "@/state/atlas";
import { openSettings } from "@/state/dialogs";
import type { Project } from "@/mygo";

// The effects load only once they are turned on (设置 → 视觉效果).
const EffectsLayer = lazy(() => import("@/components/effects/effects-layer"));

/** The main window: projects on the left, the open project's queue or overview. */
export function MainApp() {
  const ready = useAtlas((s) => s.ready);
  const loadError = useAtlas((s) => s.loadError);
  const view = useAtlas((s) => s.view);
  const project = useAtlas((s) => s.projects.find((p) => p.id === s.projectId));

  useEffect(() => {
    void init();
  }, []);
  useShortcuts();
  const effects = useEffects();

  return (
    <TooltipProvider delayDuration={500}>
      <div className="flex h-full flex-col" data-atlas-ready={ready ? "" : undefined}>
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          {/* The gutter is bare ground (the frame's color with effects off); no
              blur of its own, so the panel's frosts the background itself. */}
          <div className="flex min-w-0 flex-1 pr-2 pb-2">
            <main className="app-panel flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
              {loadError && <LoadError message={loadError} />}
              {!ready ? null : project ? (
                view === "queue" ? (
                  <QueueLayout project={project} />
                ) : (
                  <>
                    <ProjectBar project={project} />
                    <Overview project={project} />
                  </>
                )
              ) : (
                !loadError && <Welcome />
              )}
            </main>
          </div>
        </div>
      </div>
      {effects && (
        <Suspense fallback={null}>
          <EffectsLayer />
        </Suspense>
      )}
      <NameDialog />
      <ConfirmDialog />
      <SettingsDialog />
      {/* Bottom right: clear of the field that adds items. */}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

/** The queue column, with the project's controls atop it, and the detail. */
function QueueLayout({ project }: { project: Project }) {
  const layout = useDefaultLayout({ id: "vibe-atlas-queue", panelIds: ["queue", "detail"] });
  return (
    <ResizablePanelGroup className="min-h-0 flex-1" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
      <ResizablePanel id="queue" minSize={360} className="flex flex-col">
        <ProjectBar project={project} />
        <QueueFilters />
        <Queue />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="detail" defaultSize={400} minSize={300} maxSize="60%">
        <ItemDetail />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function Welcome() {
  const shortcut = useAtlas((s) => s.settings?.shortcut);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
      <span className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
        <FolderKanban className="size-6" />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold">欢迎使用 Vibe Atlas</h1>
        <p className="text-muted-foreground">先建一个项目，再把它的改进点、bug 和新需求记进来。</p>
      </div>
      <Button autoFocus onClick={newProject}>
        <Plus />
        新建项目
      </Button>
      {shortcut && <p className="text-xs text-muted-foreground">以后在任何软件里按 {shortcut}，都能快速记一条。</p>}
    </div>
  );
}

function LoadError({ message }: { message: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-destructive">
      <TriangleAlert className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">读取数据失败：{message}</span>
      <Button variant="outline" size="sm" onClick={() => void refresh()}>
        <RefreshCw />
        重试
      </Button>
    </div>
  );
}

/** Whether the effects are on; html[data-effects] turns on their CSS. */
function useEffects(): boolean {
  const effects = useAtlas((s) => s.settings?.effects ?? false);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-effects", effects);
  }, [effects]);
  return effects;
}

// ---- Keys ----

/** Whether the focus is on a control that Space and Enter press. */
function onControl(el: Element | null): boolean {
  return !!el?.closest(
    'button, a[href], [role="button"], [role="radio"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"]',
  );
}

/** Whether the focus is on a control that the arrow keys move in. */
function usesArrows(el: Element | null): boolean {
  return !!el?.closest('[role="radio"], [role="tab"], [role="slider"], [role="separator"], [data-radix-collection-item]');
}

function moveSelection(delta: number) {
  const list = visibleItems();
  if (list.length === 0) return;
  const { selectedId } = useAtlas.getState();
  const at = list.findIndex((i) => i.id === selectedId);
  const next = at < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, at + delta));
  select(list[next]!.id);
}

function editTitle() {
  const el = document.querySelector<HTMLTextAreaElement>("[data-item-title]");
  if (!el) return;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
}

/**
 * The keys of the main window. Letters act only when no field has the
 * keyboard, so that they never get in the way of typing.
 */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isComposing(e) || e.altKey) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (mod && !e.shiftKey && key === ",") {
        e.preventDefault();
        openSettings();
        return;
      }
      const focus = document.activeElement;
      if (overlayOpen() || isTypingTarget(focus)) return;
      const s = useAtlas.getState();
      if (!s.projectId || e.shiftKey) return;

      if (key === "n") {
        e.preventDefault();
        focusNewItem();
        return;
      }
      if (s.view !== "queue") return;
      const item = s.items.find((i) => i.id === s.selectedId);

      if (mod) {
        // Ctrl+C copies the item, unless the user selected text to copy.
        if (key === "c" && item && !window.getSelection()?.toString()) {
          e.preventDefault();
          void copyItem(item.id);
        }
        return;
      }
      switch (key) {
        case "ArrowDown":
        case "j":
          if (key === "ArrowDown" && usesArrows(focus)) return;
          e.preventDefault();
          moveSelection(1);
          return;
        case "ArrowUp":
        case "k":
          if (key === "ArrowUp" && usesArrows(focus)) return;
          e.preventDefault();
          moveSelection(-1);
          return;
        case "Escape":
          if (s.selectedId) {
            e.preventDefault();
            select(0);
          }
          return;
      }
      if (!item) return;
      switch (key) {
        case " ":
          if (onControl(focus)) return;
          e.preventDefault();
          toggleItemDone(item);
          break;
        case "s":
          e.preventDefault();
          toggleItemDoing(item);
          break;
        case "c":
          e.preventDefault();
          void copyItem(item.id);
          break;
        case "o":
          if (item.deeplink) {
            e.preventDefault();
            openDeeplink(item.id);
          }
          break;
        case "Enter":
        case "e":
          if (key === "Enter" && onControl(focus)) return;
          e.preventDefault();
          editTitle();
          break;
        case "Delete":
          e.preventDefault();
          confirmDeleteItem(item);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
