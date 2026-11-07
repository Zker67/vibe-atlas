import type { Item, ItemType } from "@/mygo";
import { cn } from "@/lib/utils";
import { statusInfo, typeInfo } from "@/lib/labels";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** The icon of an item's kind, in its color. */
export function TypeIcon({ type, className }: { type: ItemType; className?: string }) {
  const info = typeInfo(type);
  const Icon = info.icon;
  return <Icon aria-label={info.label} className={cn("size-3.5 shrink-0", info.text, className)} />;
}

/** An item's kind as a small colored chip. */
export function TypeChip({ type, className }: { type: ItemType; className?: string }) {
  const info = typeInfo(type);
  const Icon = info.icon;
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium", info.soft, info.text, className)}>
      <Icon className="size-3" />
      {info.label}
    </span>
  );
}

/** The circle at the start of a row: a click marks the item done, or reopens it. */
export function StatusButton({ item, onToggle }: { item: Item; onToggle(): void }) {
  const info = statusInfo(item.status);
  const Icon = info.icon;
  const label = item.status === "done" ? "重新打开" : "标为完成";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full transition-transform duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            info.text,
            item.status === "todo" && "hover:text-done",
          )}
        >
          <Icon className={cn("size-4", item.status === "doing" && "animate-pulse")} />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        <span className="ml-1.5 opacity-60">Space</span>
      </TooltipContent>
    </Tooltip>
  );
}
