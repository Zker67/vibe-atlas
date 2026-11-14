import { useMemo, useState, type ReactNode } from "react";
import { Boxes, ChevronRight, CircleCheck, FileText, History, Inbox, Layers, Play, Timer, TrendingUp } from "lucide-react";
import type { Counts, Item, Overview as OverviewData, Project } from "@/mygo";
import { cn } from "@/lib/utils";
import { useDebouncedSave } from "@/lib/debounce";
import { STATUSES, TYPES, UNSORTED } from "@/lib/labels";
import { dayKey, dayLabel, elapsed, useNow } from "@/lib/time";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { Button } from "@/components/ui/button";
import { Scroller } from "@/components/ui/scroller";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  openLink,
  setModuleFilter,
  setProjectDescription,
  setTypeFilter,
  setView,
  showItem,
  useAtlas,
  type ModuleFilter,
  type TypeFilter,
} from "@/state/atlas";
import { ModuleIcon } from "./entity-icon";
import { TypeChip, TypeIcon } from "./item-marks";

const HISTORY_PAGE = 100;

/** The project as a whole, summed up from its items. */
export function Overview({ project }: { project: Project }) {
  const overview = useAtlas((s) => (s.overview?.projectId === project.id ? s.overview : null));
  return (
    <Scroller className="flex-1">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-5">
        <Description key={project.id} project={project} />
        {!overview ? null : total(overview.totals) === 0 ? (
          <Card className="items-center justify-center gap-2 py-14 text-center text-muted-foreground">
            <div className="grid size-12 place-items-center rounded-full bg-muted">
              <Inbox className="size-6 opacity-70" />
            </div>
            <p className="mt-1 max-w-full break-words text-base font-medium text-foreground">「{project.name}」的故事，从第一条开始</p>
            <p>记下的每一条都会汇总到这里</p>
          </Card>
        ) : (
          <Summary overview={overview} />
        )}
      </div>
    </Scroller>
  );
}

/** A raised block of the page: a small titled header over its content. */
function Card({
  icon,
  title,
  aside,
  children,
  className,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-lg bg-card ring-1 ring-foreground/[0.07] animate-in fade-in-0 slide-in-from-bottom-1 duration-300",
        className,
      )}
    >
      {title && (
        <header className="flex min-h-11 items-center gap-2 px-4 pt-1.5">
          <h2 className="flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">
            {icon}
            {title}
          </h2>
          {aside && <div className="ml-auto flex min-w-0 items-center gap-2">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

function Description({ project }: { project: Project }) {
  const { schedule, flush } = useDebouncedSave((text) => {
    if (useAtlas.getState().projects.some((p) => p.id === project.id)) void setProjectDescription(project.id, text);
  });

  return (
    <Card icon={<FileText />} title="项目说明">
      <div className="px-2 pb-2">
        <MarkdownEditor
          className="min-h-20 rounded-md border border-transparent px-2 py-1 transition-[background-color,border-color,box-shadow] duration-200 hover:bg-muted/50 focus-within:border-ring focus-within:bg-transparent focus-within:ring-3 focus-within:ring-ring/30"
          value={project.description}
          placeholder="这个项目是什么、目标和约定……用 Markdown 写，边写边预览"
          onChange={schedule}
          onBlur={flush}
          onOpenLink={openLink}
        />
      </div>
    </Card>
  );
}

function total(c: Counts): number {
  return c.todo + c.doing + c.done;
}

function percent(n: number, all: number): number {
  return all ? Math.round((n / all) * 100) : 0;
}

/** 完成 9 · 进行中 2 · 待办 5, for the tooltips of the bars. */
function countsText(c: Counts): string {
  return [`完成 ${c.done}`, `进行中 ${c.doing}`, `待办 ${c.todo}`].join(" · ");
}

/**
 * How far a set of items is: done, then doing, over all of them. The
 * segments grow by their counts, with a thin gap between them.
 */
function ProgressBar({ counts, className }: { counts: Counts; className?: string }) {
  const segments = [
    { n: counts.done, className: "bg-done" },
    { n: counts.doing, className: "bg-doing" },
    { n: counts.todo, className: "bg-transparent" },
  ];
  return (
    <div className={cn("flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-foreground/[0.07]", className)}>
      {segments.map((s, i) => (
        <div
          key={i}
          className={cn("min-w-0 basis-0 rounded-full transition-[flex-grow] duration-500 ease-out", s.className, !s.n && "hidden")}
          style={{ flexGrow: s.n }}
        />
      ))}
    </div>
  );
}

/** The ring of the whole project: done, then doing, around a circle. */
function ProgressRing({ counts }: { counts: Counts }) {
  const all = total(counts);
  const r = 40;
  const c = 2 * Math.PI * r;
  const len = (n: number) => (all ? (n / all) * c : 0);
  // A gap after a segment that does not close the circle.
  const arc = (n: number) => Math.max(len(n) - (n < all ? 3 : 0), 0);
  const done = arc(counts.done);
  const doing = arc(counts.doing);
  return (
    <div className="relative size-28 shrink-0">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" className="stroke-foreground/[0.07]" />
        {counts.done > 0 && (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${done} ${c}`}
            className="stroke-done transition-[stroke-dasharray] duration-700 ease-out"
          />
        )}
        {counts.doing > 0 && (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${doing} ${c}`}
            strokeDashoffset={-len(counts.done)}
            className="stroke-doing transition-[stroke-dasharray,stroke-dashoffset] duration-700 ease-out"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {percent(counts.done, all)}
          <span className="ml-0.5 text-sm font-medium text-muted-foreground">%</span>
        </span>
        <span className="text-xs text-muted-foreground">完成</span>
      </div>
    </div>
  );
}

function openQueue(filter: { module?: ModuleFilter; type?: TypeFilter }) {
  setModuleFilter(filter.module ?? "all");
  setTypeFilter(filter.type ?? "all");
  setView("queue");
}

function Summary({ overview }: { overview: OverviewData }) {
  const { totals } = overview;
  const all = total(totals);
  return (
    <>
      <Card
        icon={<TrendingUp />}
        title="进度"
        aside={<span className="meta-mono whitespace-nowrap text-muted-foreground">共 {all} 条</span>}
      >
        <div className="flex items-center gap-6 px-5 pt-1 pb-5 max-sm:flex-col max-sm:items-stretch">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="self-center">
                <ProgressRing counts={totals} />
              </div>
            </TooltipTrigger>
            <TooltipContent>{countsText(totals)}</TooltipContent>
          </Tooltip>
          <div className="grid min-w-0 flex-1 grid-cols-3 divide-x divide-foreground/[0.07]">
            {STATUSES.map((s) => {
              const n = totals[s.value];
              const Icon = s.icon;
              return (
                <div key={s.value} className="flex min-w-0 flex-col gap-1 px-5 first:pl-0 last:pr-0">
                  <span className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
                    <Icon className={cn("size-3.5 shrink-0", s.text)} />
                    {s.label}
                  </span>
                  <span className="text-3xl font-semibold tracking-tight tabular-nums">{n}</span>
                  <span className="meta-mono whitespace-nowrap text-muted-foreground">占 {percent(n, all)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-[3fr_2fr] gap-4 max-lg:grid-cols-1">
        <Card
          icon={<Boxes />}
          title="模块进度"
          aside={<span className="meta-mono text-muted-foreground">{overview.modules.length} 个</span>}
        >
          <div className="flex flex-1 flex-col px-2 pb-2">
            {overview.modules.map((m) => (
              <BarRow
                key={m.moduleId}
                onClick={() => openQueue({ module: m.moduleId })}
                counts={m.counts}
                label={
                  <span className="flex min-w-0 items-center gap-2">
                    {m.moduleId ? (
                      <OverviewModuleIcon id={m.moduleId} />
                    ) : (
                      <Inbox className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate font-medium">{m.moduleId ? m.name : UNSORTED}</span>
                  </span>
                }
                meta={
                  <>
                    <span className="text-foreground">{m.counts.done}</span>/{total(m.counts)}
                  </>
                }
              />
            ))}
            {overview.modules.length === 0 && (
              <p className="flex flex-1 items-center justify-center py-6 text-xs text-muted-foreground">还没有模块</p>
            )}
          </div>
        </Card>

        <Card icon={<Layers />} title="类型">
          <div className="flex flex-1 flex-col px-2 pb-2">
            {overview.types.map((t) => (
              <BarRow
                key={t.type}
                onClick={() => openQueue({ type: t.type })}
                counts={t.counts}
                label={
                  <span className="flex min-w-0 items-center gap-2.5">
                    <TypeChip type={t.type} className="min-w-16 justify-center" />
                    <span className="font-medium tabular-nums">{total(t.counts)}</span>
                  </span>
                }
                meta={<TypeState counts={t.counts} />}
              />
            ))}
          </div>
        </Card>
      </div>

      {overview.ready.length > 0 && (
        <Card
          icon={<Play className="text-doing" />}
          title={
            <>
              可以开始
              <span className="meta-mono rounded-full bg-foreground/[0.07] px-1.5 py-px text-foreground">{overview.ready.length}</span>
            </>
          }
          aside={<span className="text-xs text-muted-foreground">设了前置，前置都已完成的待办</span>}
        >
          <div className="px-2 pb-2">
            <ItemList items={overview.ready} time="none" />
          </div>
        </Card>
      )}

      {overview.doing.length > 0 && (
        <Card
          icon={<span className="signal-dot ml-0.5 mr-0.5 size-1.5 rounded-full" />}
          title={
            <>
              进行中
              <span className="meta-mono rounded-full bg-doing/15 px-1.5 py-px text-doing">{overview.doing.length}</span>
            </>
          }
        >
          <div className="px-2 pb-2">
            <ItemList items={overview.doing} time="started" />
          </div>
        </Card>
      )}

      <DoneHistory done={overview.done} />
    </>
  );
}

/** What is left of a kind: 7 条没完成, 全部完成, or 还没有. */
function TypeState({ counts }: { counts: Counts }) {
  const open = counts.todo + counts.doing;
  if (!total(counts)) return <span>还没有</span>;
  if (!open)
    return (
      <span className="flex items-center gap-1 text-done">
        <CircleCheck className="size-3" />
        全部完成
      </span>
    );
  return <span>{open} 条没完成</span>;
}

/** A row of a breakdown: its name and a readout over its bar; a click opens the queue on it. */
function BarRow({
  label,
  meta,
  counts,
  onClick,
}: {
  label: ReactNode;
  meta: ReactNode;
  counts: Counts;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="signal-row group flex flex-col gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="flex w-full items-center gap-3">
        <span className="min-w-0 flex-1">{label}</span>
        <span className="meta-mono shrink-0 whitespace-nowrap text-muted-foreground">{meta}</span>
        <ChevronRight className="-ml-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-[opacity,translate] duration-150 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block w-full py-0.5">
            <ProgressBar counts={counts} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{countsText(counts)}</TooltipContent>
      </Tooltip>
    </button>
  );
}

/** A module's icon in 模块进度. */
function OverviewModuleIcon({ id }: { id: number }) {
  const module = useAtlas((s) => s.modules.find((m) => m.id === id));
  return <ModuleIcon module={module ?? { icon: "" }} className="size-3.5 text-muted-foreground" />;
}

function useModuleNames() {
  const modules = useAtlas((s) => s.modules);
  return useMemo(() => new Map(modules.map((m) => [m.id, m.name])), [modules]);
}

/** Rows of items, with when they started or were done, or no time; a click shows the item in the queue. */
function ItemList({ items, time }: { items: Item[]; time: "started" | "done" | "none" }) {
  const names = useModuleNames();
  const now = useNow();
  return (
    <div className="flex flex-col">
      {items.map((item) => {
        const at = time === "started" ? item.startedAt : item.doneAt;
        const d = new Date(at);
        const span = elapsed(at, now);
        const label =
          time === "started"
            ? span === "刚刚"
              ? "刚开始"
              : span
            : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => showItem(item)}
            className="signal-row group flex h-9 items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <TypeIcon type={item.type} />
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <span className="max-w-36 shrink-0 truncate rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {names.get(item.moduleId) ?? UNSORTED}
            </span>
            {time !== "none" && (
              <span className="flex w-20 shrink-0 items-center justify-end gap-1 whitespace-nowrap">
                {time === "started" && <Timer className="size-3 shrink-0 text-doing" />}
                <span className="meta-mono text-muted-foreground">{label}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** What was done, by day: the project's record of improvements. */
function DoneHistory({ done }: { done: Item[] }) {
  const modules = useAtlas((s) => s.modules);
  const [moduleFilter, setModule] = useState<ModuleFilter>("all");
  const [typeFilter, setType] = useState<TypeFilter>("all");
  const [limit, setLimit] = useState(HISTORY_PAGE);

  const shown = useMemo(
    () =>
      done.filter(
        (i) => (moduleFilter === "all" || i.moduleId === moduleFilter) && (typeFilter === "all" || i.type === typeFilter),
      ),
    [done, moduleFilter, typeFilter],
  );
  const days = useMemo(() => {
    const out: { key: string; at: number; items: Item[] }[] = [];
    for (const item of shown.slice(0, limit)) {
      const key = dayKey(item.doneAt);
      const last = out[out.length - 1];
      if (last?.key === key) last.items.push(item);
      else out.push({ key, at: item.doneAt, items: [item] });
    }
    return out;
  }, [shown, limit]);

  return (
    <Card
      icon={<History />}
      title="完成记录"
      aside={
        done.length > 0 && (
          <>
            <Select value={String(moduleFilter)} onValueChange={(v) => setModule(v === "all" ? "all" : Number(v))}>
              <SelectTrigger size="sm" aria-label="按模块筛选" className="max-w-40">
                <Boxes className="text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部模块</SelectItem>
                {modules.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.name}
                  </SelectItem>
                ))}
                <SelectItem value="0">{UNSORTED}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={(v) => setType(v as TypeFilter)}>
              <SelectTrigger size="sm" aria-label="按类型筛选">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <Layers className="text-muted-foreground" />
                  全部类型
                </SelectItem>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <t.icon className={t.text} />
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )
      }
    >
      {done.length === 0 ? (
        <EmptyNote>完成的改进点会按日期记在这里</EmptyNote>
      ) : shown.length === 0 ? (
        <EmptyNote>没有符合筛选条件的完成记录</EmptyNote>
      ) : (
        <div className="flex flex-col gap-1 px-2 pt-1 pb-2">
          {days.map((day) => (
            <div key={day.key}>
              <div className="flex h-8 items-center gap-2 px-2 text-xs font-medium">
                <CircleCheck className="size-3.5 text-done" />
                {dayLabel(day.at)}
                <span className="meta-mono font-normal text-muted-foreground">{day.items.length} 条</span>
                <span className="ml-1 h-px flex-1 bg-foreground/[0.07]" />
              </div>
              <ItemList items={day.items} time="done" />
            </div>
          ))}
          {shown.length > limit && (
            <Button variant="ghost" size="sm" className="mt-1 self-center text-muted-foreground" onClick={() => setLimit(limit + HISTORY_PAGE)}>
              再显示 {Math.min(HISTORY_PAGE, shown.length - limit)} 条
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 pt-4 pb-8 text-xs text-muted-foreground">
      <History className="size-5 opacity-50" />
      {children}
    </div>
  );
}
