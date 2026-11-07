import { Bug, CircleCheck, CircleDot, Circle, Lightbulb, Sparkles, type LucideIcon } from "lucide-react";
import type { ItemStatus, ItemType } from "@/mygo";

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

/** The name the pages give items without a module. */
export const UNSORTED = "未分类";
