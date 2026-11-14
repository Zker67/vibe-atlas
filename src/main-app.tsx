import { lazy, Suspense, useEffect, useRef } from "react";
import { Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { useDefaultLayout } from "react-resizable-panels";
import appIcon from "@/assets/app-icon.png";
import { isComposing, isTypingTarget, overlayOpen } from "@/lib/keys";
import { applyGlass, decorated } from "@/lib/look";
import { useEntrance } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/app/dialogs";
import { ModuleDialog, ProjectDialog } from "@/components/app/project-dialog";
import { HelpDialog } from "@/components/app/help-dialog";
import { ItemDetail } from "@/components/app/item-detail";
import { Overview } from "@/components/app/overview";
import { ProjectBar, QueueFilters } from "@/components/app/project-header";
import {
  collapseOrUp,
  confirmDeleteItem,
  confirmDeleteItems,
  expandOrDown,
  extendSelection,
  indentItems,
  outdentItems,
  Queue,
  renameInQueue,
  selectAllRows,
  visibleItems,
} from "@/components/app/queue";
import { ImmersiveNote } from "@/components/app/immersive-note";
import { SettingsDialog } from "@/components/app/settings-dialog";
import { newProject, Sidebar } from "@/components/app/sidebar";
import { TitleBar } from "@/components/app/title-bar";
import { TrashView } from "@/components/app/trash";
import { UpdateToast } from "@/components/app/update-toast";
import { purgeHeld } from "@/lib/purge-key";
import {
  copyItem,
  copyItems,
  focusNewItem,
  init,
  itemLinkSource,
  openDeeplink,
  refresh,
  select,
  selectedInOrder,
  toggleItemDoing,
  toggleItemDone,
  toggleItemsDoing,
  toggleItemsDone,
  undoTrash,
  useAtlas,
} from "@/state/atlas";
import { openHelp, openSettings } from "@/state/dialogs";
import type { Project } from "@/mygo";

// The effects load only once there is something behind the window: a
// moving background or a picture (设置 → 外观).
const EffectsLayer = lazy(() => import("@/components/effects/effects-layer"));
// The flow chart loads the first time it opens.
const FlowView = lazy(() => import("@/components/flow/flow-view"));

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
  // The panel fades in as another project or the trash opens in it; the
  // queue and the overview fade in on their own as they switch.
  const content = useRef<HTMLDivElement>(null);
  useEntrance(content, view === "trash" ? "trash" : `project-${project?.id ?? 0}`);

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
              <div ref={content} className="flex min-h-0 min-w-0 flex-1 flex-col">
                {!ready ? null : view === "trash" ? (
                  <TrashView />
                ) : project ? (
                  view === "queue" ? (
                    <QueueLayout project={project} />
                  ) : view === "flow" ? (
                    <Suspense fallback={null}>
                      <FlowView project={project} />
                    </Suspense>
                  ) : (
                    <>
                      <ProjectBar project={project} />
                      <Overview project={project} />
                    </>
                  )
                ) : (
                  !loadError && <Welcome />
                )}
              </div>
            </main>
          </div>
        </div>
      </div>
      {effects && (
        <Suspense fallback={null}>
          <EffectsLayer />
        </Suspense>
      )}
      <ProjectDialog />
      <ModuleDialog />
      <ConfirmDialog />
      <ImmersiveNote />
      <SettingsDialog />
      <HelpDialog />
      {/* Bottom right: clear of the field that adds items. */}
      <Toaster position="bottom-right" />
      <UpdateToast />
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
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8 text-center">
      <span className="relative isolate">
        <span
          aria-hidden
          className="absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--signal)_16%,transparent),transparent)]"
        />
        <img
          src={appIcon}
          alt=""
          draggable={false}
          className="size-20 rounded-[22%] shadow-[0_18px_40px_-16px_oklch(0_0_0/60%)] ring-1 ring-foreground/10"
        />
      </span>
      <h1 className="text-xl font-semibold tracking-tight">故事从第一个项目开始</h1>
      <Button autoFocus variant="outline" onClick={newProject}>
        <Plus />
        新建项目
      </Button>
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

/**
 * Whether something is behind the window, a moving background or a
 * picture; html[data-effects] turns on the CSS of the effects, the frosted
 * glass as the user set it.
 */
function useEffects(): boolean {
  const effects = useAtlas((s) => (s.settings ? decorated(s.settings) : false));
  const glass = useAtlas((s) => s.settings?.glass);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-effects", effects);
  }, [effects]);
  useEffect(() => {
    if (glass) applyGlass(glass);
  }, [glass]);
  return effects;
}

// ---- Keys ----

/** Whether the focus is on a control, which Enter presses and Tab moves on from. */
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
      if (key === "F1" && !mod && !e.shiftKey) {
        e.preventDefault();
        openHelp();
        return;
      }
      const focus = document.activeElement;
      if (overlayOpen() || isTypingTarget(focus)) return;
      const s = useAtlas.getState();
      // Tab, Shift+Tab: the selected items a level in or out. On a control, Tab moves the keyboard as ever.
      if (key === "Tab" && !mod && s.view === "queue" && s.selectedIds.size && !onControl(focus)) {
        e.preventDefault();
        if (e.shiftKey) outdentItems(selectedInOrder());
        else indentItems(selectedInOrder());
        return;
      }
      // Shift+↑ ↓: the selection stretches to the row above or below.
      if (e.shiftKey && !mod && s.view === "queue" && (key === "ArrowDown" || key === "ArrowUp") && !usesArrows(focus)) {
        e.preventDefault();
        extendSelection(key === "ArrowDown" ? 1 : -1);
        return;
      }
      // Ctrl+Z: the last deletion comes back from the trash.
      if (mod && !e.shiftKey && key === "z" && undoTrash()) {
        e.preventDefault();
        return;
      }
      // Shift+Delete: deleted for good, past the trash, after asking.
      if (key === "Delete" && !mod && purgeHeld(e) && s.view === "queue" && s.selectedIds.size) {
        e.preventDefault();
        confirmDeleteItems(selectedInOrder(), true);
        return;
      }
      if (!s.projectId || e.shiftKey) return;

      if (key === "n") {
        e.preventDefault();
        focusNewItem();
        return;
      }
      // The flow chart takes the keys of the selection too; its own keys come first (flow-board.tsx).
      if (s.view !== "queue" && s.view !== "flow") return;
      const queue = s.view === "queue";
      const item = s.items.find((i) => i.id === s.selectedId);
      // With several selected, the keys act on all of them, in the queue's order.
      const many = s.selectedIds.size > 1;
      const ids = many ? selectedInOrder() : [];

      if (mod) {
        if (key === "a" && queue) {
          e.preventDefault();
          selectAllRows();
        }
        // Ctrl+C copies the items, unless the user selected text to copy.
        if (key === "c" && item && !window.getSelection()?.toString()) {
          e.preventDefault();
          void (many ? copyItems(ids) : copyItem(item.id));
        }
        return;
      }
      switch (key) {
        case "ArrowDown":
        case "j":
          if (!queue || (key === "ArrowDown" && usesArrows(focus))) return;
          e.preventDefault();
          moveSelection(1);
          return;
        case "ArrowUp":
        case "k":
          if (!queue || (key === "ArrowUp" && usesArrows(focus))) return;
          e.preventDefault();
          moveSelection(-1);
          return;
        case "Escape":
          if (s.selectedId || s.selectedIds.size) {
            e.preventDefault();
            select(0);
          }
          return;
      }
      if (!item) return;
      switch (key) {
        case "ArrowLeft":
          if (!queue || usesArrows(focus)) return;
          e.preventDefault();
          collapseOrUp();
          break;
        case "ArrowRight":
          if (!queue || usesArrows(focus)) return;
          e.preventDefault();
          expandOrDown();
          break;
        case "d":
          e.preventDefault();
          if (many) toggleItemsDone(ids);
          else toggleItemDone(item);
          break;
        case "s":
          e.preventDefault();
          if (many) toggleItemsDoing(ids);
          else toggleItemDoing(item);
          break;
        case "c":
          e.preventDefault();
          void (many ? copyItems(ids) : copyItem(item.id));
          break;
        case "o":
          if (!many && itemLinkSource(item.id)) {
            e.preventDefault();
            openDeeplink(item.id);
          }
          break;
        case "Enter":
        case "e":
          if (many || (key === "Enter" && onControl(focus))) return;
          e.preventDefault();
          // In the queue the row itself turns into the field; elsewhere the detail's title does.
          if (!renameInQueue(item.id)) editTitle();
          break;
        case "Delete":
          e.preventDefault();
          if (many) confirmDeleteItems(ids);
          else confirmDeleteItem(item);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
