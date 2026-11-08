import { useMemo } from "react";
import { ArrowRightLeft, CircleDashed, Copy, Folder, ListChecks, Shapes, X } from "lucide-react";
import type { Item, ItemStatus, ItemType } from "@/mygo";
import { STATUSES, statusInfo, TYPES, UNSORTED } from "@/lib/labels";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Scroller } from "@/components/ui/scroller";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  copyItems,
  inQueueOrder,
  moveItemsToProject,
  select,
  setItemsModule,
  setItemsStatus,
  setItemsType,
  toggleSelected,
  useAtlas,
} from "@/state/atlas";
import { DeleteButton } from "./delete-button";
import { IconButton } from "./icon-button";
import { Prop, QUIET_TRIGGER, StatusPicker } from "./item-detail";
import { TypeChip, TypeIcon } from "./item-marks";
import { confirmDeleteItems } from "./queue";

/** What all of items have in common, or null when they differ. */
function shared<T>(items: Item[], of: (item: Item) => T): T | null {
  const first = items[0];
  if (!first) return null;
  const v = of(first);
  return items.every((i) => of(i) === v) ? v : null;
}

/**
 * The panel beside the queue while several items are selected: how many,
 * how their statuses are spread, their status, kind and module to change
 * all at once, what else to do to them all, and the list of them, the
 * queue's order, those under another of them indented.
 */
export function SelectionDetail() {
  const items = useAtlas((s) => s.items);
  const selectedIds = useAtlas((s) => s.selectedIds);
  const ids = useMemo(() => inQueueOrder(items, selectedIds), [items, selectedIds]);
  const chosen = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    return ids.map((id) => byId.get(id)!);
  }, [items, ids]);

  return (
    <div className="flex h-full min-h-0 flex-col animate-in fade-in-0 duration-200">
      <Scroller className="flex-1" viewportClassName="flex flex-col gap-3 px-4 pt-3 pb-4">
        <header className="flex items-start gap-3">
          <SelectionStack />
          <h2 className="min-w-0 flex-1 pt-1.5 text-lg leading-snug font-semibold">
            已选{" "}
            <span key={ids.length} className="inline-block tabular-nums animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
              {ids.length}
            </span>{" "}
            条
          </h2>
          <div className="-mr-1.5 flex shrink-0 items-center gap-0.5 pt-1">
            <IconButton label="复制给 AI" shortcut="C" onClick={() => void copyItems(ids)}>
              <Copy />
            </IconButton>
            <MoveMenu ids={ids} />
            <DeleteButton onDelete={(purge) => confirmDeleteItems(ids, purge)} />
            <span aria-hidden className="mx-1 h-4 w-px bg-border" />
            <IconButton label="取消选择" shortcut="Esc" onClick={() => select(0)}>
              <X />
            </IconButton>
          </div>
        </header>
        <StatusMix items={chosen} />
        <dl className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
          <Prop label="状态" icon={CircleDashed}>
            <StatusPicker value={shared(chosen, (i) => i.status)} onPick={(status) => void setItemsStatus(ids, status)} />
          </Prop>
          <Prop label="类型" icon={Shapes}>
            <TypeSelect ids={ids} items={chosen} />
          </Prop>
          <Prop label="模块" icon={Folder}>
            <ModuleSelect ids={ids} items={chosen} />
          </Prop>
        </dl>
        <SelectedList items={chosen} />
      </Scroller>
    </div>
  );
}

/** A small stack of cards: several items, held together. */
function SelectionStack() {
  const card = "absolute inset-x-0 h-9 rounded-lg ring-1 ring-foreground/10";
  return (
    <span aria-hidden className="relative mt-0.5 h-11 w-10 shrink-0">
      <span className={cn(card, "top-0 scale-x-[0.86] bg-muted/70")} />
      <span className={cn(card, "top-1 scale-x-[0.93] bg-muted")} />
      <span className={cn(card, "top-2 grid place-items-center bg-popover shadow-md")}>
        <ListChecks className="size-4 text-primary" />
      </span>
    </span>
  );
}

/** The fill of each status in the bar of StatusMix. */
const BAR: Record<ItemStatus, string> = {
  todo: "bg-muted-foreground/45",
  doing: "bg-doing",
  done: "bg-done",
};

/** How the items' statuses are spread: a bar in their colors, then how many of each. */
function StatusMix({ items }: { items: Item[] }) {
  const counts = STATUSES.map((s) => ({ ...s, count: items.filter((i) => i.status === s.value).length }));
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-2.5 ring-1 ring-foreground/[0.06]">
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        {counts.map(
          (c) =>
            c.count > 0 && (
              <span
                key={c.value}
                className={cn("h-full rounded-full transition-[flex-grow] duration-300 ease-out", BAR[c.value])}
                style={{ flexGrow: c.count }}
              />
            ),
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
        {counts.map((c) => (
          <span key={c.value} className={cn("flex items-center gap-1 transition-opacity duration-200", c.count === 0 && "opacity-50")}>
            <c.icon className={cn("size-3.5", c.text)} />
            {c.label}
            <span className="meta-mono text-foreground/90">{c.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TypeSelect({ ids, items }: { ids: number[]; items: Item[] }) {
  const type = shared(items, (i) => i.type);
  const present = TYPES.filter((t) => items.some((i) => i.type === t.value));
  return (
    <Select value={type ?? ""} onValueChange={(v) => void setItemsType(ids, v as ItemType)}>
      <SelectTrigger size="sm" aria-label="类型" className={QUIET_TRIGGER}>
        <SelectValue>
          {type ? (
            <TypeChip type={type} />
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="flex items-center gap-0.5">
                {present.map((t) => (
                  <TypeIcon key={t.value} type={t.value} />
                ))}
              </span>
              多种类型
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {TYPES.map((t) => (
          <SelectItem key={t.value} value={t.value}>
            <t.icon className={t.text} />
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ModuleSelect({ ids, items }: { ids: number[]; items: Item[] }) {
  const modules = useAtlas((s) => s.modules);
  const moduleId = shared(items, (i) => i.moduleId);
  const name = moduleId === null ? "" : modules.find((m) => m.id === moduleId)?.name;
  const spread = new Set(items.map((i) => i.moduleId)).size;
  return (
    <Select value={moduleId === null ? "" : String(moduleId)} onValueChange={(v) => void setItemsModule(ids, Number(v))}>
      <SelectTrigger size="sm" aria-label="模块" className={QUIET_TRIGGER}>
        <SelectValue>
          {moduleId === null ? (
            <span className="text-muted-foreground">分在 {spread} 个模块</span>
          ) : name ? (
            <span className="truncate">{name}</span>
          ) : (
            <span className="text-muted-foreground">选择模块</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="0">{UNSORTED}</SelectItem>
        {modules.map((m) => (
          <SelectItem key={m.id} value={String(m.id)}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Moves the items to another project, picked from a menu; gone when there is none. */
function MoveMenu({ ids }: { ids: number[] }) {
  const projects = useAtlas((s) => s.projects);
  const projectId = useAtlas((s) => s.projectId);
  const others = projects.filter((p) => p.id !== projectId);
  if (others.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="移到其他项目">
          <ArrowRightLeft />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-48 overflow-y-auto">
        <DropdownMenuLabel>移到其他项目</DropdownMenuLabel>
        {others.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => void moveItemsToProject(ids, p.id)}>
            <span className="truncate">{p.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The items selected, one line each: a click opens that one alone, the ×
 * under the pointer leaves it out. A line slides in as its item is added.
 */
function SelectedList({ items }: { items: Item[] }) {
  const modules = useAtlas((s) => s.modules);
  const all = useAtlas((s) => s.items);
  const names = useMemo(() => new Map(modules.map((m) => [m.id, m.name])), [modules]);
  // How many of the items above each one are selected too: it sits that far in.
  const levels = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const parentOf = new Map(all.map((i) => [i.id, i.parentId]));
    return new Map(
      items.map((it) => {
        let level = 0;
        const seen = new Set<number>();
        for (let p = it.parentId; p && !seen.has(p); p = parentOf.get(p) ?? 0) {
          seen.add(p);
          if (byId.has(p)) level++;
        }
        return [it.id, level];
      }),
    );
  }, [items, all]);

  return (
    <section aria-label="已选的改进点" className="flex flex-col gap-1">
      <h3 className="flex h-6 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <ListChecks className="size-3.5" />
        已选的改进点
      </h3>
      <ul className="flex flex-col">
        {items.map((it) => {
          const info = statusInfo(it.status);
          return (
            <li
              key={it.id}
              className="group/line flex h-8 items-center gap-1 rounded-md transition-colors duration-150 animate-in fade-in-0 slide-in-from-left-1 hover:bg-muted/60"
              style={{ paddingLeft: (levels.get(it.id) ?? 0) * 16 }}
            >
              <button
                type="button"
                onClick={() => select(it.id)}
                className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <info.icon aria-label={info.label} className={cn("size-3.5 shrink-0", info.text)} />
                <TypeIcon type={it.type} />
                <span className={cn("min-w-0 flex-1 truncate", it.status === "done" && "text-muted-foreground")}>{it.title}</span>
                {it.moduleId !== 0 && (
                  <span className="max-w-28 shrink-0 truncate rounded-sm bg-muted px-1.5 text-xs leading-5 text-muted-foreground">
                    {names.get(it.moduleId)}
                  </span>
                )}
              </button>
              <IconButton
                size="icon-xs"
                label="不选这一条"
                className="mr-0.5 opacity-0 transition-opacity duration-150 group-hover/line:opacity-100 focus-visible:opacity-100"
                onClick={() => toggleSelected(it.id)}
              >
                <X />
              </IconButton>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
