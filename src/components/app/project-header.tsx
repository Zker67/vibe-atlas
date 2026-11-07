import { useMemo } from "react";
import { ChartPie, ChevronDown, FolderOpen, FolderPlus, FolderX, ListTodo, Pencil, Trash2, TriangleAlert, X } from "lucide-react";
import type { Project } from "@/mygo";
import { cn } from "@/lib/utils";
import { statusInfo, TYPES } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  chooseProjectFolder,
  clearFilters,
  clearProjectFolder,
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
import { IconButton } from "./icon-button";
import { confirmDeleteProject, promptRenameProject } from "./sidebar";

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function FolderButton({ project }: { project: Project }) {
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
          className={cn("max-w-40", !project.folderExists && "text-destructive")}
          onClick={() => openProjectFolder(project.id)}
        >
          {project.folderExists ? <FolderOpen /> : <TriangleAlert />}
          <span className="hidden truncate @min-[520px]:inline">{folderName(project.folderPath)}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-96 break-all">
        {project.folderExists ? project.folderPath : `文件夹不存在：${project.folderPath}`}
      </TooltipContent>
    </Tooltip>
  );
}

/** The open project's first row, atop the queue column or the overview. */
export function ProjectBar({ project }: { project: Project }) {
  const view = useAtlas((s) => s.view);

  return (
    <div className="@container flex h-12 shrink-0 items-center gap-1 border-b px-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="max-w-48 min-w-0 px-2 text-sm font-semibold">
            <span className="truncate">{project.name}</span>
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onSelect={() => promptRenameProject(project)}>
            <Pencil />
            重命名
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
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => confirmDeleteProject(project)}>
            <Trash2 />
            删除项目
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FolderButton project={project} />

      {/* A segmented control: a faint track, the chosen part raised. */}
      <ToggleGroup
        type="single"
        size="sm"
        spacing={0}
        value={view}
        onValueChange={(v) => v && setView(v as View)}
        aria-label="视图"
        className="ml-auto shrink-0 rounded-lg bg-muted p-0.5"
      >
        {VIEWS.map((v) => (
          <ToggleGroupItem
            key={v.value}
            value={v.value}
            aria-label={v.label}
            title={v.label}
            className="h-6 rounded-md! px-2 text-muted-foreground hover:bg-transparent data-[state=on]:bg-foreground/10 data-[state=on]:text-foreground data-[state=on]:shadow-xs"
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
