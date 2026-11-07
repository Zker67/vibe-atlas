import { ChartPie, ChevronDown, FolderOpen, FolderPlus, FolderX, ListTodo, Pencil, Trash2, TriangleAlert, X } from "lucide-react";
import type { Project } from "@/mygo";
import { cn } from "@/lib/utils";
import { TYPES } from "@/lib/labels";
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
  setTypeFilter,
  setView,
  useAtlas,
  type TypeFilter,
  type View,
} from "@/state/atlas";
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
            <span className="hidden @min-[760px]:inline">绑定文件夹</span>
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
          <span className="hidden truncate @min-[760px]:inline">{folderName(project.folderPath)}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-96 break-all">
        {project.folderExists ? project.folderPath : `文件夹不存在：${project.folderPath}`}
      </TooltipContent>
    </Tooltip>
  );
}

/** The open project's controls, in the title bar: narrow bars show icons only. */
export function ProjectHeader({ project }: { project: Project }) {
  const view = useAtlas((s) => s.view);
  const typeFilter = useAtlas((s) => s.typeFilter);
  const moduleFilter = useAtlas((s) => s.moduleFilter);
  const filtered = typeFilter !== "all" || moduleFilter !== "all";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="max-w-48 px-2 text-sm font-semibold">
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

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={view}
        onValueChange={(v) => v && setView(v as View)}
        className="ml-1"
      >
        <ToggleGroupItem value="queue" aria-label="队列">
          <ListTodo />
          <span className="hidden @min-[600px]:inline">队列</span>
        </ToggleGroupItem>
        <ToggleGroupItem value="overview" aria-label="总览">
          <ChartPie />
          <span className="hidden @min-[600px]:inline">总览</span>
        </ToggleGroupItem>
      </ToggleGroup>

      {view === "queue" && (
        <div className="ml-auto flex items-center gap-1">
          {filtered && (
            <Button variant="ghost" size="sm" aria-label="清除筛选" title="清除筛选" className="text-muted-foreground" onClick={clearFilters}>
              <X />
              <span className="hidden @min-[760px]:inline">清除筛选</span>
            </Button>
          )}
          <ToggleGroup
            type="single"
            size="sm"
            value={typeFilter}
            onValueChange={(v) => setTypeFilter((v || "all") as TypeFilter)}
          >
            <ToggleGroupItem value="all">全部</ToggleGroupItem>
            {TYPES.map((t) => (
              <ToggleGroupItem key={t.value} value={t.value} aria-label={t.label} title={t.label}>
                <t.icon className={t.text} />
                <span className="hidden @min-[760px]:inline">{t.label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
    </div>
  );
}
