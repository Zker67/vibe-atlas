import { useMemo, useState } from "react";
import {
  ArrowRightLeft,
  ChartPie,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderX,
  ListTodo,
  SquarePen,
  Trash2,
  TriangleAlert,
  Workflow,
  X,
} from "lucide-react";
import type { Project } from "@/mygo";
import { cn } from "@/lib/utils";
import { statusInfo, TYPES } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  chooseProjectFolder,
  clearFilters,
  clearProjectFolder,
  moveProjectToOrg,
  openProjectFolder,
  sections,
  setStatusFilter,
  setTypeFilter,
  setView,
  useAtlas,
  type StatusFilter,
  type TypeFilter,
  type View,
} from "@/state/atlas";
import { askProject } from "@/state/dialogs";
import { OrgIcon, ProjectIcon } from "./entity-icon";
import { IconButton } from "./icon-button";
import { confirmDeleteProject } from "./sidebar";

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * The folder of the project bar: closed, opening under the pointer, and
 * popping open once each click. A new key replays the pop.
 */
function FolderIcon({ popping, onPopped }: { popping: boolean; onPopped(): void }) {
  return (
    <span data-popping={popping || undefined} onAnimationEnd={onPopped} className="folder-icon grid shrink-0 place-items-center">
      <Folder className="folder-closed col-start-1 row-start-1" />
      <FolderOpen className="folder-open col-start-1 row-start-1" />
    </span>
  );
}

function FolderButton({ project }: { project: Project }) {
  // Each click plays the pop again, under a new key; it closes once played.
  const [opening, setOpening] = useState(0);
  const [popping, setPopping] = useState(false);
  if (!project.folderPath) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="绑定文件夹" className="text-muted-foreground" onClick={() => void chooseProjectFolder(project.id)}>
            <FolderPlus />
            <span className="hidden @min-[520px]:inline">绑定文件夹</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>可选：绑定后可以一键打开项目文件夹</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={folderName(project.folderPath)}
          className={cn(
            "group/folder max-w-40 transition-[color,background-color,scale] duration-150 active:scale-95",
            project.folderExists ? "text-muted-foreground hover:text-foreground" : "text-destructive",
          )}
          onClick={() => {
            setOpening((n) => n + 1);
            setPopping(true);
            openProjectFolder(project.id);
          }}
        >
          {project.folderExists ? <FolderIcon key={opening} popping={popping} onPopped={() => setPopping(false)} /> : <TriangleAlert />}
          <span className="hidden truncate @min-[520px]:inline">{folderName(project.folderPath)}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-96 break-all">
        {project.folderExists ? project.folderPath : `文件夹不存在：${project.folderPath}`}
      </TooltipContent>
    </Tooltip>
  );
}

/** The open project's first row, atop the queue column, the flow chart or the overview. */
export function ProjectBar({ project }: { project: Project }) {
  const view = useAtlas((s) => s.view);
  const orgs = useAtlas((s) => s.orgs);
  const otherOrgs = orgs.filter((o) => o.id !== project.orgId);

  return (
    <div className="@container flex h-12 shrink-0 items-center gap-1 border-b px-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="max-w-52 min-w-0 px-2 text-sm font-semibold">
            <ProjectIcon project={project} className="size-4" />
            <span className="truncate">{project.name}</span>
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onSelect={() => askProject(project)}>
            <SquarePen />
            编辑项目
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void chooseProjectFolder(project.id)}>
            <FolderPlus />
            {project.folderPath ? "更换文件夹" : "绑定文件夹"}
          </DropdownMenuItem>
          {project.folderPath && (
            <DropdownMenuItem onSelect={() => void clearProjectFolder(project.id)}>
              <FolderX />
              解除绑定
            </DropdownMenuItem>
          )}
          {otherOrgs.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRightLeft />
                移到组织
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 w-48 overflow-y-auto">
                {otherOrgs.map((o) => (
                  <DropdownMenuItem key={o.id} onSelect={() => void moveProjectToOrg(project.id, o.id)}>
                    <OrgIcon org={o} />
                    <span className="truncate">{o.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => confirmDeleteProject(project)}>
            <Trash2 />
            删除项目
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* On the right, before the views. */}
      <div className="ml-auto flex min-w-0 items-center">
        <FolderButton project={project} />
      </div>

      {/* A segmented control: a faint track, the chosen part raised. */}
      <ToggleGroup
        type="single"
        size="sm"
        spacing={0}
        value={view}
        onValueChange={(v) => v && setView(v as View)}
        aria-label="视图"
        className="shrink-0 rounded-lg bg-muted p-0.5"
        glideClassName="bg-foreground/10 shadow-xs"
        // The bar is another one in the queue, the flow chart and the overview.
        glideMemory="views"
      >
        {VIEWS.map((v) => (
          <ToggleGroupItem
            key={v.value}
            value={v.value}
            aria-label={v.label}
            title={v.label}
            className="h-6 rounded-md! px-2 text-muted-foreground hover:bg-transparent data-[state=on]:text-foreground"
          >
            <v.icon />
            <span className="hidden @min-[420px]:inline">{v.label}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

const VIEWS: { value: View; label: string; icon: typeof ListTodo }[] = [
  { value: "queue", label: "队列", icon: ListTodo },
  { value: "flow", label: "流程图", icon: Workflow },
  { value: "overview", label: "总览", icon: ChartPie },
];

/** The queue's order of the statuses, as its sections show them. */
const STATUS_ORDER = (["doing", "todo", "done"] as const).map(statusInfo);

/**
 * The queue's second row: by status on the left, each with how many the
 * kind and module filters leave; by kind on the right, where clicking the
 * chosen kind again shows them all.
 */
export function QueueFilters() {
  const items = useAtlas((s) => s.items);
  const typeFilter = useAtlas((s) => s.typeFilter);
  const moduleFilter = useAtlas((s) => s.moduleFilter);
  const statusFilter = useAtlas((s) => s.statusFilter);
  const counts = useMemo(() => sections(items, typeFilter, moduleFilter), [items, typeFilter, moduleFilter]);
  const filtered = typeFilter !== "all" || moduleFilter !== "all" || statusFilter !== "all";
  const all = counts.doing.length + counts.todo.length + counts.done.length;

  return (
    <div className="@container flex h-10 shrink-0 items-center gap-2 px-2 pt-1">
      <ToggleGroup
        type="single"
        size="sm"
        spacing={0.5}
        value={statusFilter}
        onValueChange={(v) => setStatusFilter((v || "all") as StatusFilter)}
        aria-label="按状态筛选"
        className="min-w-0"
      >
        <ToggleGroupItem value="all" className={FILTER_ITEM}>
          全部
          <Count n={all} />
        </ToggleGroupItem>
        {STATUS_ORDER.map((s) => (
          <ToggleGroupItem key={s.value} value={s.value} aria-label={s.label} title={s.label} className={FILTER_ITEM}>
            <s.icon className={s.text} />
            <span className="hidden @min-[480px]:inline">{s.label}</span>
            <Count n={counts[s.value].length} />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {filtered && (
          <IconButton label="清除筛选" size="icon-xs" className="text-muted-foreground" onClick={clearFilters}>
            <X />
          </IconButton>
        )}
        <ToggleGroup
          type="single"
          size="sm"
          spacing={0.5}
          value={typeFilter === "all" ? "" : typeFilter}
          onValueChange={(v) => setTypeFilter((v || "all") as TypeFilter)}
          aria-label="按类型筛选"
        >
          {TYPES.map((t) => (
            <ToggleGroupItem key={t.value} value={t.value} aria-label={t.label} title={t.label} className={FILTER_ITEM}>
              <t.icon className={t.text} />
              <span className="hidden @min-[640px]:inline">{t.label}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}

const FILTER_ITEM = "rounded-full px-2.5 text-muted-foreground data-[state=on]:text-foreground";

function Count({ n }: { n: number }) {
  return <span className="meta-mono text-muted-foreground">{n}</span>;
}
