import { ChevronDown, Flag } from "lucide-react";
import type { Project, ProjectStage } from "@/mygo";
import { cn } from "@/lib/utils";
import { STAGES, stageInfo } from "@/lib/labels";
import { elapsed, fullTime, useNow } from "@/lib/time";
import { ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setProjectStage } from "@/state/atlas";

/** How long the project has been at its stage: 开发中 · 已 12 天. */
function stageSince(project: Project, now: number): string {
  const label = stageInfo(project.stage).label;
  const span = elapsed(project.stageAt, now);
  if (!span) return label;
  return span === "刚刚" ? `${label} · 刚刚` : `${label} · 已 ${span}`;
}

/** A stage in a menu: its icon in its color, and its name. */
function StageLabel({ stage }: { stage: ProjectStage }) {
  const info = stageInfo(stage);
  return (
    <>
      <info.icon className={info.text} />
      {info.label}
    </>
  );
}

const pick = (id: number) => (v: string) => void setProjectStage(id, v as ProjectStage);

/**
 * In the project bar, beside the project's name: its stage as a small chip
 * in the stage's color, which a click changes from a menu. A narrow bar
 * keeps the icon alone.
 */
export function StageButton({ project }: { project: Project }) {
  const info = stageInfo(project.stage);
  const now = useNow();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`项目阶段：${info.label}`}
          title={`${stageSince(project, now)}（${fullTime(project.stageAt)} 起）`}
          className={cn(
            "signal-chip inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap transition-[filter] duration-150 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-3.5 [&_svg]:shrink-0",
            info.chip,
          )}
        >
          <info.icon />
          <span className="hidden @min-[480px]:inline">{info.label}</span>
          <ChevronDown className="opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuLabel>项目阶段</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={project.stage} onValueChange={pick(project.id)}>
          {STAGES.map((s) => (
            <DropdownMenuRadioItem key={s.value} value={s.value}>
              <StageLabel stage={s.value} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 阶段 ▸ in the project menu. */
export function StageDropdownSub({ project }: { project: Project }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Flag />
        阶段
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-40">
        <DropdownMenuRadioGroup value={project.stage} onValueChange={pick(project.id)}>
          {STAGES.map((s) => (
            <DropdownMenuRadioItem key={s.value} value={s.value}>
              <StageLabel stage={s.value} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** 阶段 ▸ in a project's right-click menu in the sidebar. */
export function StageContextSub({ project }: { project: Project }) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Flag />
        阶段
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-40">
        <ContextMenuRadioGroup value={project.stage} onValueChange={pick(project.id)}>
          {STAGES.map((s) => (
            <ContextMenuRadioItem key={s.value} value={s.value}>
              <StageLabel stage={s.value} />
            </ContextMenuRadioItem>
          ))}
        </ContextMenuRadioGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
