import { BookOpen, Boxes, CornerDownRight, FolderKanban, Inbox, LayoutList, Plus, Settings, SquarePen, Trash2, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import type { Module, Project } from "@/mygo";
import { cn } from "@/lib/utils";
import { run } from "@/lib/api";
import { isComposing } from "@/lib/keys";
import { Glide } from "@/lib/motion";
import { UNSORTED } from "@/lib/labels";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Scroller } from "@/components/ui/scroller";
import {
  deleteModule,
  deleteProject,
  detectProjectIcon,
  moveModule,
  moveProject,
  openProject,
  renameModule,
  renameProject,
  setModuleFilter,
  setModuleIcon,
  setProjectIcon,
  setView,
  useAtlas,
  type ModuleFilter,
} from "@/state/atlas";
import { askConfirm, askModule, askProject, openHelp, openSettings } from "@/state/dialogs";
import { ModuleIcon, ProjectIcon } from "./entity-icon";
import { IconButton } from "./icon-button";
import { IconPopover } from "./icon-picker";
import { useModuleDropOver } from "./queue";
import { SortableList, SortableRow } from "./sortable";

export function newProject() {
  askProject();
}

export function newModule() {
  askModule();
}

export function confirmDeleteProject(project: Project) {
  const total = project.counts.todo + project.counts.doing + project.counts.done;
  askConfirm({
    title: `删除项目「${project.name}」？`,
    description: total > 0 ? `它的模块和 ${total} 条改进点会一起删除，无法恢复。` : "它的模块会一起删除，无法恢复。",
    confirmText: "删除",
    destructive: true,
    onConfirm: () => deleteProject(project.id),
  });
}

export function Sidebar() {
  return (
    <aside className="app-frame flex w-60 shrink-0 flex-col text-sidebar-foreground">
      <Projects />
      <Modules />
      <div className="mt-auto flex shrink-0 flex-col gap-0.5 border-t p-2">
        <TrashButton />
        <FooterButton icon={BookOpen} label="使用说明" shortcut="F1" onClick={() => openHelp()} />
        <FooterButton icon={Settings} label="设置" shortcut="Ctrl+," onClick={() => openSettings()} />
      </div>
    </aside>
  );
}

/** 回收站: opens the trash in the panel, or goes back to the queue; its icon bounces as items come in. */
function TrashButton() {
  const count = useAtlas((s) => s.trashCount);
  const active = useAtlas((s) => s.view === "trash");
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setView(active ? "queue" : "trash")}
      className={cn(
        "signal-row flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-150",
        active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <Trash2 key={count} className={cn("size-4 shrink-0", count > 0 && "animate-in duration-300 zoom-in-50")} />
      <span className="flex-1">回收站</span>
      {count > 0 && <span className="meta-mono opacity-70">{count}</span>}
    </button>
  );
}

function FooterButton({ icon: Icon, label, shortcut, onClick }: { icon: LucideIcon; label: string; shortcut: string; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="signal-row flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-foreground"
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1">{label}</span>
      <span className="meta-mono opacity-70">{shortcut}</span>
    </button>
  );
}

function SectionHeader({ title, onAdd, addLabel }: { title: string; onAdd(): void; addLabel: string }) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between px-3 pt-2 text-xs font-medium text-muted-foreground">
      <span>{title}</span>
      <IconButton label={addLabel} size="icon-xs" onClick={onAdd}>
        <Plus />
      </IconButton>
    </div>
  );
}

interface RowProps {
  icon: LucideIcon;
  /** The row's own icon, drawn in place of icon with rowIcon's classes. */
  iconNode?: ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick(): void;
  /** Shown before the count: the project has something doing. */
  doing?: boolean;
  onDoubleClick?(): void;
  /** Takes the label's place: the field that renames the row. */
  editor?: ReactNode;
  /** The module a row of the queue dropped here goes to, 0 for 未分类. */
  dropModule?: number;
}

/** The fill under a list's row picked, sliding to the one picked now; hidden while rows are dragged. */
const SIDEBAR_GLIDE = { className: "bg-sidebar-accent in-[.dragging-rows]:invisible", selector: '[data-active="true"]' };

/** The classes of a row's icon. */
const rowIcon = (active: boolean) => cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground");

function Row({ icon: Icon, iconNode, label, count, active, onClick, doing, onDoubleClick, editor, dropModule }: RowProps) {
  const Tag = editor ? "div" : "button";
  const dropOver = useModuleDropOver(dropModule ?? -1);
  return (
    <Tag
      type={editor ? undefined : "button"}
      onClick={editor ? undefined : onClick}
      onDoubleClick={onDoubleClick}
      data-module-drop={dropModule}
      data-active={active}
      className={cn(
        "signal-row relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-150",
        // The list's Glide is its fill, but while rows are dragged, when the Glide hides.
        active ? "font-medium text-sidebar-accent-foreground in-[.dragging-rows]:bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
        dropOver > 0 && "bg-primary/10 shadow-[inset_0_0_0_1.5px_var(--primary)] hover:bg-primary/10",
      )}
    >
      {iconNode ?? <Icon className={rowIcon(active)} />}
      {editor ?? <span className="min-w-0 flex-1 truncate">{label}</span>}
      {doing && <span className="signal-dot size-1.5 shrink-0 rounded-full" aria-label="有进行中的改进点" />}
      {dropOver > 0 ? (
        <span className="flex h-5 shrink-0 items-center gap-1 rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground shadow-md animate-in fade-in-0 zoom-in-90 duration-150">
          <CornerDownRight className="size-3" />
          移入
          {dropOver > 1 && <span className="meta-mono opacity-80">· {dropOver} 条</span>}
        </span>
      ) : (
        count !== undefined && count > 0 && <span className="meta-mono text-muted-foreground">{count}</span>
      )}
    </Tag>
  );
}

function Projects() {
  const projects = useAtlas((s) => s.projects);
  const projectId = useAtlas((s) => s.projectId);
  return (
    <section className="flex max-h-[45%] min-h-0 flex-col">
      <SectionHeader title="项目" addLabel="新建项目" onAdd={newProject} />
      <Scroller viewportClassName="relative flex-initial px-2 pb-2">
        <Glide {...SIDEBAR_GLIDE} />
        <SortableList ids={projects.map((p) => p.id)} onMove={(id, overId) => moveProject(id, overId)}>
          {projects.map((p) => (
            <ProjectRow key={p.id} project={p} active={p.id === projectId} />
          ))}
        </SortableList>
      </Scroller>
    </section>
  );
}

/** A project in the sidebar: dragged into another order, double-clicked to rename. */
function ProjectRow({ project: p, active }: { project: Project; active: boolean }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <SortableRow id={p.id}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
            <Row
              icon={FolderKanban}
              iconNode={<ProjectIconSpot project={p} active={active} />}
              label={p.name}
              count={p.counts.todo + p.counts.doing}
              doing={p.counts.doing > 0}
              active={active}
              onClick={() => openProject(p.id)}
              onDoubleClick={renaming ? undefined : () => setRenaming(true)}
              editor={
                renaming ? (
                  <NameInput
                    name={p.name}
                    label="项目名称"
                    maxLength={60}
                    onSave={(name) => renameProject(p.id, name)}
                    onDone={() => setRenaming(false)}
                  />
                ) : undefined
              }
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => askProject(p)}>
            <SquarePen />
            编辑项目
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => confirmDeleteProject(p)}>
            <Trash2 />
            删除项目
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </SortableRow>
  );
}

/**
 * The icon of a row, which a click changes in a picker by it, as a double
 * click renames. The popover's trigger passes its props and ref through.
 */
function IconSpot({ open, className, onClick, ...props }: ComponentProps<"span"> & { open: boolean }) {
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-label="更换图标"
      {...props}
      // The click opens the picker, not the row; a double click does not rename.
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        "-m-1 flex shrink-0 rounded-sm p-1 transition-[background-color,scale] duration-150 hover:scale-110 hover:bg-foreground/10",
        open && "bg-foreground/10",
        className,
      )}
    />
  );
}

function ProjectIconSpot({ project: p, active }: { project: Project; active: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <IconPopover
      open={open}
      onOpenChange={setOpen}
      side="right"
      value={p.icon}
      fallback={FolderKanban}
      onPick={async (icon) => {
        if (await setProjectIcon(p.id, icon)) setOpen(false);
      }}
      auto={{ detected: p.detectedIcon, hasFolder: !!p.folderPath, onDetect: async () => void (await detectProjectIcon(p.id)) }}
    >
      <IconSpot open={open}>
        <ProjectIcon project={p} className={rowIcon(active)} />
      </IconSpot>
    </IconPopover>
  );
}

function ModuleIconSpot({ module: m, active }: { module: Module; active: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <IconPopover
      open={open}
      onOpenChange={setOpen}
      side="right"
      value={m.icon}
      fallback={Boxes}
      onPick={async (icon) => {
        if (await setModuleIcon(m.id, icon)) setOpen(false);
      }}
    >
      <IconSpot open={open}>
        <ModuleIcon module={m} className={rowIcon(active)} />
      </IconSpot>
    </IconPopover>
  );
}

function confirmDeleteModule(m: Module) {
  const total = m.counts.todo + m.counts.doing + m.counts.done;
  askConfirm({
    title: `删除模块「${m.name}」？`,
    description: total > 0 ? `下面的 ${total} 条改进点不会删除，会变成「${UNSORTED}」。` : undefined,
    confirmText: "删除",
    destructive: true,
    onConfirm: () => deleteModule(m.id),
  });
}

function Modules() {
  const projectId = useAtlas((s) => s.projectId);
  const modules = useAtlas((s) => s.modules);
  const items = useAtlas((s) => s.items);
  const filter = useAtlas((s) => s.moduleFilter);
  if (!projectId) return null;

  const open = items.filter((i) => i.status !== "done");
  const unsortedTotal = items.filter((i) => i.moduleId === 0).length;
  const unsortedOpen = open.filter((i) => i.moduleId === 0).length;
  const pick = (f: ModuleFilter) => setModuleFilter(filter === f ? "all" : f);

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t">
      <SectionHeader title="模块" addLabel="新建模块" onAdd={newModule} />
      <Scroller className="flex-1" viewportClassName="relative px-2 pb-3">
        <Glide {...SIDEBAR_GLIDE} />
        <Row icon={LayoutList} label="全部" count={open.length} active={filter === "all"} onClick={() => setModuleFilter("all")} />
        <SortableList ids={modules.map((m) => m.id)} onMove={(id, overId) => moveModule(id, overId)}>
          {modules.map((m) => (
            <ModuleRow key={m.id} module={m} active={filter === m.id} onClick={() => pick(m.id)} />
          ))}
        </SortableList>
        {unsortedTotal > 0 && (
          <Row icon={Inbox} label={UNSORTED} count={unsortedOpen} active={filter === 0} onClick={() => pick(0)} dropModule={0} />
        )}
      </Scroller>
    </section>
  );
}

/** A module in the sidebar: dragged into another order, double-clicked to rename. */
function ModuleRow({ module: m, active, onClick }: { module: Module; active: boolean; onClick(): void }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <SortableRow id={m.id}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
            <Row
              icon={Boxes}
              iconNode={<ModuleIconSpot module={m} active={active} />}
              label={m.name}
              count={m.counts.todo + m.counts.doing}
              doing={m.counts.doing > 0}
              active={active}
              onClick={onClick}
              dropModule={m.id}
              onDoubleClick={
                renaming
                  ? undefined
                  : () => {
                      // The two clicks before toggled the filter off again: keep the module shown.
                      setModuleFilter(m.id);
                      setRenaming(true);
                    }
              }
              editor={
                renaming ? (
                  <NameInput
                    name={m.name}
                    label="模块名称"
                    maxLength={40}
                    onSave={(name) => renameModule(m.id, name)}
                    onDone={() => setRenaming(false)}
                  />
                ) : undefined
              }
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => askModule(m)}>
            <SquarePen />
            编辑模块
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => confirmDeleteModule(m)}>
            <Trash2 />
            删除模块
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </SortableRow>
  );
}

interface NameInputProps {
  name: string;
  label: string;
  maxLength: number;
  onSave(name: string): Promise<unknown>;
  onDone(): void;
}

/** The field a name is edited in, in its row: Enter or leaving it saves, Esc cancels. */
function NameInput({ name: initial, label, maxLength, onSave, onDone }: NameInputProps) {
  const [draft, setDraft] = useState(initial);
  const field = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const finish = () => {
    const name = draft.trim();
    if (!cancelled.current && name && name !== initial) void run(onSave(name));
    onDone();
  };

  return (
    <input
      ref={field}
      value={draft}
      maxLength={maxLength}
      aria-label={label}
      spellCheck={false}
      className="-mx-1 h-6 min-w-0 flex-1 rounded-sm bg-background px-1 font-normal ring-1 ring-ring/50 outline-none"
      onChange={(e) => setDraft(e.target.value)}
      // Selecting text in the field must not drag the row.
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={finish}
      onKeyDown={(e) => {
        if (isComposing(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
