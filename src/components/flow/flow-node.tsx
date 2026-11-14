import { memo } from "react";
import { CornerLeftUp, FileText } from "lucide-react";
import type { Item } from "@/mygo";
import { NODE_HEIGHT, NODE_WIDTH } from "@/lib/flow/layout";
import { cn } from "@/lib/utils";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { StatusButton, TypeIcon } from "@/components/app/item-marks";
import { RowMenuItems, selectForMenu, WaitMark } from "@/components/app/queue";
import { toggleItemDone } from "@/state/atlas";

export interface FlowNodeProps {
  item: Item;
  x: number;
  y: number;
  selected: boolean;
  /** It is the one the keys act from, among several selected. */
  focus: boolean;
  /** The titles of the prerequisites it still waits for, a line each, or "". */
  waiting: string;
  /** The title of the item it sits under, or "". */
  parent: string;
  /** Its module's name, or "". */
  module: string;
  /** A line being drawn would land on it: "ok", "no" (it cannot take it), or "". */
  target: "ok" | "no" | "";
  /** It moves with the pointer. */
  dragging: boolean;
}

/**
 * A card of the flow chart: the item's status (a click finishes or
 * reopens it), kind and title, with its parent, module and what it waits
 * for under; a handle on each side to draw lines from. Pressed, it drags
 * (flow-board.tsx); right-clicked, it has the queue's menu.
 */
export const FlowNode = memo(function FlowNode({ item, x, y, selected, focus, waiting, parent, module, target, dragging }: FlowNodeProps) {
  const done = item.status === "done";
  return (
    <ContextMenu onOpenChange={(open) => open && selectForMenu(item.id)}>
      <ContextMenuTrigger asChild>
        <div
          data-flow-node=""
          data-id={item.id}
          style={{ transform: `translate(${x}px, ${y}px)`, width: NODE_WIDTH, height: NODE_HEIGHT }}
          className={cn(
            "group/node absolute top-0 left-0 flex flex-col justify-between rounded-lg border bg-card px-2.5 py-2 shadow-xs transition-[box-shadow,border-color,opacity] duration-150",
            item.status === "doing" && "border-doing/50 bg-[color-mix(in_oklch,var(--doing)_6%,var(--card))]",
            done && "opacity-60",
            selected && "border-primary/70 shadow-[0_0_0_1px_var(--primary)]",
            focus && "shadow-[0_0_0_1px_var(--primary),0_0_0_4px_color-mix(in_oklch,var(--primary)_22%,transparent)]",
            dragging && "z-10 shadow-lg",
            target === "ok" && "border-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_30%,transparent)]",
            target === "no" && "border-destructive/70",
          )}
        >
          <Port side="in" />
          <Port side="out" />
          <div className="flex min-w-0 items-start gap-1.5">
            <StatusButton item={item} onToggle={() => toggleItemDone(item)} />
            <span className={cn("line-clamp-2 min-w-0 flex-1 text-sm leading-5 break-words", done && "text-muted-foreground line-through decoration-muted-foreground/50")}>
              {item.title}
            </span>
          </div>
          <div className="flex h-4 min-w-0 items-center gap-1.5 pl-0.5 text-xs text-muted-foreground">
            <TypeIcon type={item.type} className="size-3" />
            {parent && (
              <span className="flex min-w-0 items-center gap-0.5">
                <CornerLeftUp className="size-3 shrink-0" />
                <span className="truncate">{parent}</span>
              </span>
            )}
            {module && <span className="min-w-0 shrink truncate rounded-sm bg-muted px-1 leading-4">{module}</span>}
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {item.note.trim() && <FileText aria-label="有备注" className="size-3" />}
              {waiting && <WaitMark titles={waiting} className="[&_svg]:size-3" />}
            </span>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-52"
        // Out in a portal, its events still bubble through React to the
        // card and the board: a press would start dragging.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <RowMenuItems item={item} />
      </ContextMenuContent>
    </ContextMenu>
  );
});

/** A handle to draw lines from: on the left, to a prerequisite; on the right, to an item that waits for this one. */
function Port({ side }: { side: "in" | "out" }) {
  return (
    <span
      data-flow-port={side}
      aria-hidden
      title={side === "out" ? "拖到另一条：那条等这条" : "拖到另一条：这条等那条"}
      className={cn(
        "absolute top-1/2 z-10 grid size-5 -translate-y-1/2 cursor-crosshair place-items-center opacity-0 transition-opacity duration-150 group-hover/node:opacity-100 [[data-linking]_&]:opacity-100",
        side === "in" ? "-left-2.5" : "-right-2.5",
      )}
    >
      <span className="size-2.5 rounded-full border-2 border-primary bg-background transition-transform duration-150 hover:scale-125" />
    </span>
  );
}
