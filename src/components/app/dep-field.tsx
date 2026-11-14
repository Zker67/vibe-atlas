import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Item } from "@/mygo";
import { statusInfo } from "@/lib/labels";
import { depCandidates, depIndex, type DepSide } from "@/lib/deps";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addDep, removeDep, select, useAtlas } from "@/state/atlas";
import { IconButton } from "./icon-button";
import { TypeIcon } from "./item-marks";

const SIDE_TEXT: Record<DepSide, { add: string; search: string; empty: string; none: string }> = {
  before: { add: "添加前置", search: "搜索要先做的改进点", empty: "没有可以作为前置的改进点", none: "要先做完的改进点" },
  after: { add: "添加后续", search: "搜索要等这条的改进点", empty: "没有可以作为后续的改进点", none: "等这条做完再做的改进点" },
};

/**
 * The prerequisites of an item (before: those it waits for) or the items
 * that wait for it (after): a chip each, which opens it, with × under the
 * pointer; then 「添加」, which searches the project's items it may take.
 */
export function DepField({ item, side }: { item: Item; side: DepSide }) {
  const items = useAtlas((s) => s.items);
  const deps = useAtlas((s) => s.deps);
  const [open, setOpen] = useState(false);
  const linked = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const ids = depIndex(deps)[side].get(item.id) ?? [];
    return ids.map((id) => byId.get(id)).filter((i): i is Item => !!i);
  }, [items, deps, item.id, side]);
  const text = SIDE_TEXT[side];
  const [fromOf, toOf] = side === "before" ? [(o: number) => o, () => item.id] : [() => item.id, (o: number) => o];

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 py-0.5">
      {linked.map((other) => (
        <DepChip
          key={other.id}
          item={other}
          // A prerequisite not done yet is what this one waits for.
          waiting={side === "before" && other.status !== "done" && item.status !== "done"}
          onRemove={() => void removeDep(fromOf(other.id), toOf(other.id))}
        />
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {linked.length ? (
            <IconButton label={text.add} size="icon-xs" className="text-muted-foreground">
              <Plus />
            </IconButton>
          ) : (
            <Button variant="ghost" size="sm" title={text.none} className="h-7 px-1.5 font-normal text-muted-foreground">
              <Plus />
              {text.add}
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          {open && (
            <DepPicker
              item={item}
              side={side}
              placeholder={text.search}
              empty={text.empty}
              onPick={(other) => {
                setOpen(false);
                void addDep(fromOf(other), toOf(other));
              }}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function DepChip({ item, waiting, onRemove }: { item: Item; waiting: boolean; onRemove(): void }) {
  const status = statusInfo(item.status);
  return (
    <span
      className={cn(
        "group/dep relative inline-flex h-6 max-w-full min-w-0 items-center rounded-md bg-muted/70 text-xs transition-colors hover:bg-muted",
        waiting && "shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--doing)_35%,transparent)]",
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => select(item.id)}
            className="flex h-full min-w-0 items-center gap-1 rounded-md pr-5 pl-1.5 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <status.icon className={cn("size-3 shrink-0", status.text)} />
            <span className={cn("max-w-44 truncate", item.status === "done" && "text-muted-foreground")}>{item.title}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-80">
          {waiting ? "还没完成，" : ""}
          {status.label}：{item.title}
        </TooltipContent>
      </Tooltip>
      <button
        type="button"
        aria-label={`去掉「${item.title}」`}
        onClick={onRemove}
        className="absolute right-0.5 grid size-4 place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover/dep:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/** The search of the items an item may take on a side, as depCandidates lists them. */
function DepPicker({
  item,
  side,
  placeholder,
  empty,
  onPick,
}: {
  item: Item;
  side: DepSide;
  placeholder: string;
  empty: string;
  onPick(id: number): void;
}) {
  const items = useAtlas((s) => s.items);
  const deps = useAtlas((s) => s.deps);
  const candidates = useMemo(() => depCandidates(items, deps, item.id, side), [items, deps, item.id, side]);
  return (
    <Command loop>
      <CommandInput placeholder={placeholder} />
      <CommandList>
        <CommandEmpty className="py-4 text-xs text-muted-foreground">{candidates.length ? "没有找到" : empty}</CommandEmpty>
        <CommandGroup>
          {candidates.map((c) => {
            const status = statusInfo(c.status);
            return (
              <CommandItem key={c.id} value={`${c.id} ${c.title}`} onSelect={() => onPick(c.id)}>
                <status.icon className={cn("size-3.5", status.text)} />
                <TypeIcon type={c.type} />
                <span className={cn("min-w-0 flex-1 truncate", c.status === "done" && "text-muted-foreground")}>{c.title}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
