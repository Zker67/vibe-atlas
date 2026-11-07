import { BookOpen, Boxes, FolderKanban, Inbox, LayoutList, Pencil, Plus, Settings, Trash2, type LucideIcon } from "lucide-react";
import type { Module, Project } from "@/mygo";
import { cn } from "@/lib/utils";
import { UNSORTED } from "@/lib/labels";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  createModule,
  createProject,
  deleteModule,
  deleteProject,
  moveModule,
  moveProject,
  openProject,
  renameModule,
  renameProject,
  setModuleFilter,
  useAtlas,
  type ModuleFilter,
} from "@/state/atlas";
import { askConfirm, askName, openHelp, openSettings } from "@/state/dialogs";
import { IconButton } from "./icon-button";
import { SortableList, SortableRow } from "./sortable";

export function newProject() {
  askName({ title: "新建项目", placeholder: "项目名称，比如「规则恐怖」", confirmText: "创建", onSubmit: createProject });
}

export function newModule() {
  askName({ title: "新建模块", placeholder: "模块名称，比如「武器系统」", confirmText: "创建", onSubmit: createModule });
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

export function promptRenameProject(project: Project) {
  askName({ title: "重命名项目", initial: project.name, onSubmit: (name) => renameProject(project.id, name) });
}

export function Sidebar() {
  return (
    <aside className="app-frame flex w-60 shrink-0 flex-col text-sidebar-foreground">
      <Projects />
      <Modules />
      <div className="mt-auto flex shrink-0 flex-col gap-0.5 border-t p-2">
        <FooterButton icon={BookOpen} label="使用说明" shortcut="F1" onClick={() => openHelp()} />
        <FooterButton icon={Settings} label="设置" shortcut="Ctrl+," onClick={() => openSettings()} />
      </div>
    </aside>
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
  label: string;
  count?: number;
  active: boolean;
  onClick(): void;
  /** Shown before the count: the project has something doing. */
  doing?: boolean;
}

function Row({ icon: Icon, label, count, active, onClick, doing }: RowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "signal-row flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-150",
        active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {doing && <span className="signal-dot size-1.5 shrink-0 rounded-full" aria-label="有进行中的改进点" />}
      {count !== undefined && count > 0 && <span className="meta-mono text-muted-foreground">{count}</span>}
    </button>
  );
}

function Projects() {
  const projects = useAtlas((s) => s.projects);
  const projectId = useAtlas((s) => s.projectId);
  return (
    <section className="flex max-h-[45%] min-h-0 flex-col">
      <SectionHeader title="项目" addLabel="新建项目" onAdd={newProject} />
      <div className="min-h-0 overflow-y-auto px-2 pb-2">
        <SortableList ids={projects.map((p) => p.id)} onMove={(id, overId) => moveProject(id, overId)}>
          {projects.map((p) => (
            <SortableRow key={p.id} id={p.id}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div>
                    <Row
                      icon={FolderKanban}
                      label={p.name}
                      count={p.counts.todo + p.counts.doing}
                      doing={p.counts.doing > 0}
                      active={p.id === projectId}
                      onClick={() => openProject(p.id)}
                    />
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => promptRenameProject(p)}>
                    <Pencil />
                    重命名
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={() => confirmDeleteProject(p)}>
                    <Trash2 />
                    删除项目
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </SortableRow>
          ))}
        </SortableList>
      </div>
    </section>
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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <Row icon={LayoutList} label="全部" count={open.length} active={filter === "all"} onClick={() => setModuleFilter("all")} />
        <SortableList ids={modules.map((m) => m.id)} onMove={(id, overId) => moveModule(id, overId)}>
          {modules.map((m) => (
            <SortableRow key={m.id} id={m.id}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div>
                    <Row
                      icon={Boxes}
                      label={m.name}
                      count={m.counts.todo + m.counts.doing}
                      doing={m.counts.doing > 0}
                      active={filter === m.id}
                      onClick={() => pick(m.id)}
                    />
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() => askName({ title: "重命名模块", initial: m.name, onSubmit: (name) => renameModule(m.id, name) })}
                  >
                    <Pencil />
                    重命名
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={() => confirmDeleteModule(m)}>
                    <Trash2 />
                    删除模块
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </SortableRow>
          ))}
        </SortableList>
        {unsortedTotal > 0 && (
          <Row icon={Inbox} label={UNSORTED} count={unsortedOpen} active={filter === 0} onClick={() => pick(0)} />
        )}
      </div>
    </section>
  );
}
