import {
  Archive,
  Bug,
  CircleCheck,
  CircleDot,
  Circle,
  FlaskConical,
  Hammer,
  Lightbulb,
  NotebookPen,
  Rocket,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ItemStatus, ItemType, Project, ProjectStage } from "@/mygo";

export interface TypeInfo {
  value: ItemType;
  label: string;
  icon: LucideIcon;
  /** Text color, from the theme tokens. */
  text: string;
  /** Sets --chip, the color of .signal-chip and .signal-dot. */
  chip: string;
}

export const TYPES: TypeInfo[] = [
  { value: "improve", label: "改进", icon: Sparkles, text: "text-improve", chip: "[--chip:var(--improve)]" },
  { value: "bug", label: "bug", icon: Bug, text: "text-bug", chip: "[--chip:var(--bug)]" },
  { value: "feature", label: "新需求", icon: Lightbulb, text: "text-feature", chip: "[--chip:var(--feature)]" },
];

export function typeInfo(t: ItemType): TypeInfo {
  return TYPES.find((x) => x.value === t) ?? TYPES[0]!;
}

/** The next kind, for Tab in the fields that add items. */
export function nextType(t: ItemType, back = false): ItemType {
  const i = TYPES.findIndex((x) => x.value === t);
  const n = TYPES.length;
  return TYPES[(i + (back ? n - 1 : 1)) % n]!.value;
}

export interface StatusInfo {
  value: ItemStatus;
  label: string;
  icon: LucideIcon;
  text: string;
}

export const STATUSES: StatusInfo[] = [
  { value: "todo", label: "待办", icon: Circle, text: "text-muted-foreground" },
  { value: "doing", label: "进行中", icon: CircleDot, text: "text-doing" },
  { value: "done", label: "完成", icon: CircleCheck, text: "text-done" },
];

export function statusInfo(s: ItemStatus): StatusInfo {
  return STATUSES.find((x) => x.value === s) ?? STATUSES[0]!;
}

export interface StageInfo {
  value: ProjectStage;
  label: string;
  icon: LucideIcon;
  /** Text color, from the theme tokens. */
  text: string;
  /** Sets --chip, the color of .signal-chip and .signal-text. */
  chip: string;
}

/** A project's stages, in the order a project goes through them. */
export const STAGES: StageInfo[] = [
  { value: "planning", label: "立项中", icon: NotebookPen, text: "text-feature", chip: "[--chip:var(--feature)]" },
  { value: "developing", label: "开发中", icon: Hammer, text: "text-improve", chip: "[--chip:var(--improve)]" },
  { value: "testing", label: "测试中", icon: FlaskConical, text: "text-doing", chip: "[--chip:var(--doing)]" },
  { value: "live", label: "上线中", icon: Rocket, text: "text-done", chip: "[--chip:var(--done)]" },
  { value: "finished", label: "完结", icon: Archive, text: "text-muted-foreground", chip: "[--chip:var(--muted-foreground)]" },
];

export function stageInfo(s: ProjectStage): StageInfo {
  return STAGES.find((x) => x.value === s) ?? STAGES[1]!;
}

/** The projects with the finished ones last, each part in the user's order: for lists to pick a project from. */
export function finishedLast(projects: Project[]): Project[] {
  return [...projects.filter((p) => p.stage !== "finished"), ...projects.filter((p) => p.stage === "finished")];
}

/** The name the pages give items without a module. */
export const UNSORTED = "未分类";
