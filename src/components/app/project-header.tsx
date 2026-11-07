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
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void chooseProjectFolder(project.id)}>
            <FolderPlus />
            绑定文件夹
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
          className={cn("max-w-56", !project.folderExists && "text-destructive")}
          onClick={() => openProjectFolder(project.id)}
        >
          {project.folderExists ? <FolderOpen /> : <TriangleAlert />}
          <span className="truncate">{folderName(project.folderPath)}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-96 break-all">
        {project.folderExists ? project.folderPath : `文件夹不存在：${project.folderPath}`}
      </TooltipContent>
    </Tooltip>
  );
}

export function ProjectHeader({ project }: { project: Project }) {
  const view = useAtlas((s) => s.view);
  const typeFilter = useAtlas((s) => s.typeFilter);
  const moduleFilter = useAtlas((s) => s.moduleFilter);
  const filtered = typeFilter !== "all" || moduleFilter !== "all";

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="max-w-72 px-2 text-base font-semibold">
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
        className="ml-2"
      >
        <ToggleGroupItem value="queue" aria-label="队列">
          <ListTodo />
          队列
        </ToggleGroupItem>
        <ToggleGroupItem value="overview" aria-label="总览">
          <ChartPie />
          总览
        </ToggleGroupItem>
      </ToggleGroup>

      {view === "queue" && (
        <div className="ml-auto flex items-center gap-1">
          {filtered && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clearFilters}>
              <X />
              清除筛选
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
              <ToggleGroupItem key={t.value} value={t.value} aria-label={t.label}>
                <t.icon className={t.text} />
                {t.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
    </header>
  );
}
