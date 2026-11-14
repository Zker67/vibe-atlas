import { memo } from "react";
import { CornerLeftUp, FileText, ListTree } from "lucide-react";
import type { Item } from "@/mygo";
import { NODE_HEIGHT, NODE_WIDTH, ROW_HEIGHT, ROWS_PAD, TITLE_LINES, TITLE_WIDTH } from "@/lib/flow/layout";
import { cn } from "@/lib/utils";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { StatusButton, TypeIcon } from "@/components/app/item-marks";
import { RowMenuItems, selectForMenu, WaitMark } from "@/components/app/queue";
import { toggleItemDone } from "@/state/atlas";

/** A line being drawn: from which item and side, and why each item cannot take it ("" when it can). */
export interface LinkView {
  fromId: number;
  side: "out" | "in";
  problems: ReadonlyMap<number, string>;
}

/** A row under a card's head. */
export interface FlowRowData {
  item: Item;
  /** 1 right under the head. */
  depth: number;
}

export interface FlowCardProps {
  /** The item heading the card. */
  root: Item;
  /** The items under it, as rows. */
  rows: readonly FlowRowData[];
  x: number;
  y: number;
  height: number;
  /** How tall the head is: a third line of title makes it taller. */
  head: number;
  /** The ids of the card's items that are selected, joined by commas. */
  selected: string;
  /** The item of the card the keys act from among several selected, or 0. */
  focus: number;
  /** The titles of the prerequisites each item still waits for, a line each. */
  waits: ReadonlyMap<number, string>;
  /** The title of the item the head sits under, when that one does not show, or "". */
  parent: string;
  /** The head's module, or "". */
  module: string;
  /** How many items sit under the head and how many are done, as 「2/5」, or "". */
  progress: string;
  /** The line being drawn, or null. */
  link: LinkView | null;
  /** The item of the card the line being drawn would land on, or 0. */
  over: number;
  /** It moves with the pointer. */
  dragging: boolean;
}

/** How a handle shows: as usual, plain to see (it can take the line), hot (the line lands there), or not at all. */
type PortMode = "" | "on" | "hot" | "off";

/** What the line being drawn makes of an item: its handles, whether it fades (it cannot take the line), how the line lands on it. */
interface Marks {
  in: PortMode;
  out: PortMode;
  faded: boolean;
  landing: "" | "ok" | "no";
}

const PLAIN: Marks = { in: "", out: "", faded: false, landing: "" };

function linkMarks(id: number, link: LinkView | null, over: number): Marks {
  if (!link) return PLAIN;
  if (id === link.fromId) return { ...PLAIN, in: link.side === "in" ? "hot" : "off", out: link.side === "out" ? "hot" : "off" };
  const problem = link.problems.get(id) ?? "";
  const landing = over === id ? (problem ? "no" : "ok") : "";
  if (problem) return { in: "off", out: "off", faded: landing === "", landing };
  // A line from a right side lands on a left one, and the other way.
  const mode: PortMode = landing ? "hot" : "on";
  return { in: link.side === "out" ? mode : "off", out: link.side === "in" ? mode : "off", faded: false, landing };
}

/**
 * A card of the flow chart: an item, and the items under it as rows. The
 * head shows the item's status (a click finishes or reopens it), kind and
 * title, with its parent, module, what it waits for, and how many under it
 * are done; each row the same, shorter. Each item has a handle on each
 * side to draw lines from, and the queue's menu on a right click. Pressed
 * anywhere, the card drags (flow-board.tsx).
 */
export const FlowCard = memo(function FlowCard({
  root,
  rows,
  x,
  y,
  height,
  head: headTall,
  selected,
  focus,
  waits,
  parent,
  module,
  progress,
  link,
  over,
  dragging,
}: FlowCardProps) {
  const chosen = new Set(selected ? selected.split(",").map(Number) : []);
  const group = rows.length > 0;
  const head = linkMarks(root.id, link, over);
  const done = root.status === "done";
  return (
    <div
      data-flow-node=""
      data-id={root.id}
      style={{ transform: `translate(${x}px, ${y}px)`, width: NODE_WIDTH, height }}
      className={cn(
        "group/node absolute top-0 left-0 flex flex-col rounded-lg border bg-card shadow-xs transition-[box-shadow,border-color] duration-150",
        // A card with items under it looks like a small stack.
        group && "shadow-[3px_3px_0_-1px_var(--card),3px_3px_0_0_var(--border)]",
        root.status === "doing" && "border-doing/50",
        chosen.has(root.id) && "border-primary/70 shadow-[0_0_0_1px_var(--primary)]",
        focus === root.id && "shadow-[0_0_0_1px_var(--primary),0_0_0_4px_color-mix(in_oklch,var(--primary)_22%,transparent)]",
        dragging && "z-10 shadow-lg",
        head.landing === "ok" && "border-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_30%,transparent)]",
        head.landing === "no" && "border-destructive/70",
      )}
    >
      <ContextMenu onOpenChange={(open) => open && selectForMenu(root.id)}>
        <ContextMenuTrigger asChild>
          <div
            data-flow-item=""
            data-id={root.id}
            style={group ? { height: headTall - 1 } : undefined}
            className={cn(
              "group/item relative flex shrink-0 flex-col justify-between rounded-t-[7px] px-2.5 py-2 transition-opacity duration-150",
              group ? "border-b" : "h-full rounded-b-[7px]",
              root.status === "doing" && "bg-[color-mix(in_oklch,var(--doing)_6%,var(--card))]",
              done && "opacity-60",
              head.faded && "opacity-40",
            )}
          >
            <Port side="in" mode={head.in} idle="opacity-40" />
            <Port side="out" mode={head.out} idle="opacity-40" />
            <div className="flex min-w-0 items-start gap-1.5">
              <StatusButton item={root} onToggle={() => toggleItemDone(root)} />
              <span className={cn(headTall > NODE_HEIGHT ? "line-clamp-3" : "line-clamp-2", "min-w-0 flex-1 text-sm leading-5 break-words", done && "text-muted-foreground line-through decoration-muted-foreground/50")}>
                {root.title}
              </span>
            </div>
            <div className="flex h-4 min-w-0 items-center gap-1.5 pl-0.5 text-xs text-muted-foreground">
              <TypeIcon type={root.type} className="size-3" />
              {parent && (
                <span className="flex min-w-0 items-center gap-0.5">
                  <CornerLeftUp className="size-3 shrink-0" />
                  <span className="truncate">{parent}</span>
                </span>
              )}
              {module && <span className="min-w-0 shrink truncate rounded-sm bg-muted px-1 leading-4">{module}</span>}
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {root.note.trim() && <FileText aria-label="有备注" className="size-3" />}
                {waits.get(root.id) && <WaitMark titles={waits.get(root.id)!} className="[&_svg]:size-3" />}
                {progress && (
                  <span title={`子改进点完成了 ${progress}`} className="meta-mono flex items-center gap-0.5">
                    <ListTree className="size-3" />
                    {progress}
                  </span>
                )}
              </span>
            </div>
          </div>
        </ContextMenuTrigger>
        <MenuContent item={root} />
      </ContextMenu>
      {group && (
        <div className="relative flex flex-col" style={{ paddingTop: ROWS_PAD, paddingBottom: ROWS_PAD - 1 }}>
          <span aria-hidden className="absolute top-0 w-px bg-border" style={{ left: guideX(1), height: ROWS_PAD }} />
          {rows.map((row, i) => (
            <FlowRow
              key={row.item.id}
              row={row}
              guides={guidesAt(rows, i)}
              selected={chosen.has(row.item.id)}
              focus={focus === row.item.id}
              waiting={waits.get(row.item.id) ?? ""}
              marks={linkMarks(row.item.id, link, over)}
            />
          ))}
        </div>
      )}
    </div>
  );
});

let measure: CanvasRenderingContext2D | null = null;
const lineCounts = new Map<string, number>();

/**
 * How many lines a head's title takes, up to TITLE_LINES, measured in the
 * card's font (text-sm). A little over the width counts as a line more:
 * words wrap before the edge.
 */
export function titleLines(title: string): number {
  const known = lineCounts.get(title);
  if (known !== undefined) return known;
  measure ??= document.createElement("canvas").getContext("2d");
  if (!measure) return 2;
  measure.font = `14px ${getComputedStyle(document.body).fontFamily}`;
  const width = measure.measureText(title).width;
  const lines = Math.min(TITLE_LINES, Math.max(1, Math.ceil((width * 1.06) / TITLE_WIDTH)));
  lineCounts.set(title, lines);
  return lines;
}

/** How far in a row's tree lines are, by depth: under the head's status, then under each row's. */
const guideX = (depth: number) => 20 + (depth - 1) * 16;

/**
 * The tree lines through row i: for each depth up to its own, whether the
 * line goes on under it (an item that deep follows before one shallower).
 */
function guidesAt(rows: readonly FlowRowData[], i: number): boolean[] {
  const depth = rows[i]!.depth;
  const goesOn: boolean[] = [];
  for (let k = 1; k <= depth; k++) {
    let on = false;
    for (let j = i + 1; j < rows.length; j++) {
      const d = rows[j]!.depth;
      if (d < k) break;
      if (d === k) {
        on = true;
        break;
      }
    }
    goesOn.push(on);
  }
  return goesOn;
}

/** A row of a card: an item under the head, in from the left as deep as it sits, with its tree lines. */
function FlowRow({
  row,
  guides,
  selected,
  focus,
  waiting,
  marks,
}: {
  row: FlowRowData;
  guides: boolean[];
  selected: boolean;
  focus: boolean;
  waiting: string;
  marks: Marks;
}) {
  const { item, depth } = row;
  const done = item.status === "done";
  return (
    <ContextMenu onOpenChange={(open) => open && selectForMenu(item.id)}>
      <ContextMenuTrigger asChild>
        <div
          data-flow-item=""
          data-id={item.id}
          style={{ height: ROW_HEIGHT, paddingLeft: guideX(depth + 1) - 10 }}
          className={cn(
            "group/item relative flex items-center gap-1.5 pr-2.5 transition-[opacity,background-color] duration-150",
            item.status === "doing" && "bg-[color-mix(in_oklch,var(--doing)_6%,var(--card))]",
            selected && "bg-primary/10",
            focus && "bg-primary/15",
            marks.landing === "ok" && "bg-primary/15 shadow-[inset_0_0_0_1px_var(--primary)]",
            marks.landing === "no" && "bg-destructive/10",
            marks.faded && "opacity-40",
          )}
        >
          {guides.map((on, k) => {
            const own = k === depth - 1;
            // Lines of the items above go through; its own comes down to it, and on when another follows.
            if (!own && !on) return null;
            return (
              <span
                key={k}
                aria-hidden
                className="absolute w-px bg-border"
                style={{ left: guideX(k + 1), top: 0, bottom: own && !on ? ROW_HEIGHT / 2 : 0 }}
              />
            );
          })}
          <span aria-hidden className="absolute h-px w-1.5 bg-border" style={{ left: guideX(depth), top: ROW_HEIGHT / 2 }} />
          {(selected || focus) && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />}
          <Port side="in" mode={marks.in} idle="opacity-0" />
          <Port side="out" mode={marks.out} idle="opacity-0" />
          <StatusButton item={item} onToggle={() => toggleItemDone(item)} />
          <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-5", done && "text-muted-foreground line-through decoration-muted-foreground/50")}>
            {item.title}
          </span>
          {item.note.trim() && <FileText aria-label="有备注" className="size-3 shrink-0 text-muted-foreground" />}
          {waiting && <WaitMark titles={waiting} className="[&_svg]:size-3" />}
        </div>
      </ContextMenuTrigger>
      <MenuContent item={item} />
    </ContextMenu>
  );
}

/** The queue's menu for an item, kept from the card and the board: out in a portal, its events still bubble through React. */
function MenuContent({ item }: { item: Item }) {
  return (
    <ContextMenuContent
      className="w-52"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <RowMenuItems item={item} />
    </ContextMenuContent>
  );
}

/**
 * A handle to draw lines from: on the left, to a prerequisite; on the
 * right, to an item that waits for this one. idle is how it shows when
 * nothing goes on; the card under the pointer shows its handles more, the
 * row under it fully.
 */
function Port({ side, mode, idle }: { side: "in" | "out"; mode: PortMode; idle: string }) {
  return (
    <span
      data-flow-port={side}
      aria-hidden
      title={side === "out" ? "拖到另一条：那条等这条做完" : "拖到另一条：这条等那条做完"}
      className={cn(
        "absolute top-1/2 z-10 grid size-5 -translate-y-1/2 cursor-crosshair place-items-center transition-opacity duration-150",
        side === "in" ? "-left-2.5" : "-right-2.5",
        mode === "" && cn(idle, "group-hover/node:opacity-70 group-hover/item:opacity-100"),
        (mode === "on" || mode === "hot") && "opacity-100",
        mode === "off" && "pointer-events-none opacity-0",
      )}
    >
      <span
        className={cn(
          "size-2.5 rounded-full border-2 border-primary bg-background transition-transform duration-150 hover:scale-125",
          mode === "hot" && "scale-150 bg-primary",
        )}
      />
    </span>
  );
}
