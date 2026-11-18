import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, ChartPie, ChevronRight, Flag, History, LayoutGrid, ListTodo, Plus, SquarePen, X } from "lucide-react";
import type { Counts, Project, ProjectActivity, ProjectStage } from "@/mygo";
import { isComposing, isTypingTarget, overlayOpen } from "@/lib/keys";
import { STAGES, stageInfo, statusInfo } from "@/lib/labels";
import { dayKey, dayLabel, elapsed, fullTime, useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Scroller } from "@/components/ui/scroller";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ACTIVITY_DAYS, openProject, setView, useAtlas, useOrgProjects } from "@/state/atlas";
import { askProject } from "@/state/dialogs";
import { OrgIcon, ProjectIcon } from "./entity-icon";
import { Card, ProgressBar, ProgressBody, percent, total } from "./overview";
import { StageContextSub } from "./stage";

/** The days a project card charts. */
const CARD_DAYS = 14;

/** The order of the statuses on a card, as the queue shows them. */
const STATUS_ORDER = (["doing", "todo", "done"] as const).map(statusInfo);

const DoneIcon = statusInfo("done").icon;

/** A day of the charts: its start, in local time, and how many items were done on it. */
interface Day {
  at: number;
  n: number;
}

/** The last count days, today last, with how many of done fell on each. */
function lastDays(done: number[], count: number, now: number): Day[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days: Day[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setDate(start.getDate() - i);
    days.push({ at: d.getTime(), n: 0 });
  }
  const index = new Map(days.map((d, i) => [dayKey(d.at), i]));
  for (const t of done) {
    const i = index.get(dayKey(t));
    if (i !== undefined) days[i]!.n++;
  }
  return days;
}

/**
 * 全部项目: the organization's projects at a glance. How many are at each
 * stage, which a click narrows the page to; their items and what was done
 * of late; then a card for each, by stage, which a click opens.
 */
export function ProjectsBoard() {
  const projects = useOrgProjects();
  const org = useAtlas((s) => s.orgs.find((o) => o.id === s.orgId));
  const activity = useAtlas((s) => (s.activityOrg === s.orgId ? s.activity : null));
  const [filter, setFilter] = useState<ProjectStage | null>(null);
  const now = useNow();

  // Esc lets go of the stage first, then goes back to the queue.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isComposing(e) || overlayOpen() || isTypingTarget(document.activeElement)) return;
      e.preventDefault();
      if (filter) setFilter(null);
      else setView("queue");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filter]);

  const shown = filter ? projects.filter((p) => p.stage === filter) : projects;
  const activityOf = useMemo(() => new Map((activity ?? []).map((a) => [a.projectId, a])), [activity]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <LayoutGrid className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold whitespace-nowrap">全部项目</h2>
        {org && (
          <span className="flex h-5 min-w-0 items-center gap-1 rounded-md bg-foreground/[0.04] px-1.5 text-xs text-muted-foreground ring-1 ring-foreground/[0.06]">
            <OrgIcon org={org} className="size-3 opacity-80" />
            <span className="max-w-40 truncate">{org.name}</span>
          </span>
        )}
        <span className="meta-mono text-muted-foreground">{projects.length}</span>
        <div className="ml-auto flex items-center gap-1">
          {filter && <FilterChip stage={filter} onClear={() => setFilter(null)} />}
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => askProject()}>
            <Plus />
            新建项目
          </Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <Empty name={org?.name} />
      ) : (
        <Scroller className="flex-1">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5">
            <StageCard projects={projects} filter={filter} onFilter={setFilter} now={now} />
            <div className="grid grid-cols-[2fr_3fr] gap-4 max-xl:grid-cols-1">
              <Card
                icon={<ListTodo />}
                title="改进点"
                aside={<span className="meta-mono whitespace-nowrap text-muted-foreground">共 {total(sumCounts(shown))} 条</span>}
              >
                <ProgressBody counts={sumCounts(shown)} />
              </Card>
              <ActivityCard projects={shown} activityOf={activityOf} ready={!!activity} now={now} />
            </div>
            <ProjectGroups projects={shown} filter={filter} activityOf={activityOf} now={now} />
          </div>
        </Scroller>
      )}
    </div>
  );
}

function sumCounts(projects: Project[]): Counts {
  const c: Counts = { todo: 0, doing: 0, done: 0 };
  for (const p of projects) {
    c.todo += p.counts.todo;
    c.doing += p.counts.doing;
    c.done += p.counts.done;
  }
  return c;
}

/** In the page's header while a stage narrows it: the stage, and × to show them all. */
function FilterChip({ stage, onClear }: { stage: ProjectStage; onClear(): void }) {
  const info = stageInfo(stage);
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`不再只看${info.label}`}
      className={cn(
        "signal-chip mr-1 inline-flex h-6 items-center gap-1 rounded-full pr-1.5 pl-2 text-xs font-medium whitespace-nowrap transition-[filter] duration-150 animate-in fade-in-0 zoom-in-95 hover:brightness-110",
        info.chip,
      )}
    >
      <info.icon className="size-3.5" />
      只看{info.label}
      <X className="size-3 opacity-70" />
    </button>
  );
}

function Empty({ name }: { name: string | undefined }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
      <div className="grid size-12 place-items-center rounded-full bg-muted">
        <LayoutGrid className="size-6 opacity-70" />
      </div>
      <p className="mt-1 text-base font-medium text-foreground">{name ? `「${name}」还没有项目` : "还没有项目"}</p>
      <p className="text-xs">每个项目的阶段、进度和最近的动静都会汇总在这里</p>
      <Button variant="outline" className="mt-2" onClick={() => askProject()}>
        <Plus />
        新建项目
      </Button>
    </div>
  );
}

/**
 * 阶段分布: a strip in the stages' colors, as long as their numbers of
 * projects, over a tile for each stage. A click on a tile shows only that
 * stage on the page; another click shows them all.
 */
function StageCard({
  projects,
  filter,
  onFilter,
  now,
}: {
  projects: Project[];
  filter: ProjectStage | null;
  onFilter(stage: ProjectStage | null): void;
  now: number;
}) {
  const stages = STAGES.map((info) => ({ info, list: projects.filter((p) => p.stage === info.value) }));
  return (
    <Card
      icon={<Flag />}
      title="阶段分布"
      aside={<span className="meta-mono whitespace-nowrap text-muted-foreground">共 {projects.length} 个项目</span>}
    >
      <div className="flex flex-col gap-4 px-5 pt-1 pb-5">
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-foreground/[0.07]">
          {stages.map(({ info, list }) => (
            <Tooltip key={info.value}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "min-w-0 basis-0 rounded-full bg-(--chip) transition-[flex-grow,opacity] duration-500 ease-out",
                    info.chip,
                    !list.length && "hidden",
                    filter && filter !== info.value && "opacity-25",
                  )}
                  style={{ flexGrow: list.length }}
                />
              </TooltipTrigger>
              <TooltipContent>
                {info.label}
                <span className="meta-mono opacity-60">{list.length} 个</span>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-2 max-md:grid-cols-3">
          {stages.map(({ info, list }) => {
            const on = filter === info.value;
            return (
              <button
                key={info.value}
                type="button"
                aria-pressed={on}
                onClick={() => onFilter(on ? null : info.value)}
                className={cn(
                  "flex min-w-0 flex-col gap-2 rounded-lg p-3 text-left ring-1 ring-foreground/[0.06] transition-[background-color,box-shadow,opacity] duration-200 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                  info.chip,
                  on && "signal-chip hover:bg-transparent",
                  !list.length && !on && "opacity-55",
                )}
              >
                <span className="flex min-w-0 items-center gap-2 text-xs font-medium whitespace-nowrap text-muted-foreground">
                  <span className={cn("signal-chip grid size-6 shrink-0 place-items-center rounded-md", info.chip)}>
                    <info.icon className="size-3.5" />
                  </span>
                  {info.label}
                </span>
                <span className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">{list.length}</span>
                <span className="meta-mono truncate text-muted-foreground">{stageNote(info.value, list, now)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/** Under a stage's number: how long the longest has been at it, or when the last one was finished. */
function stageNote(stage: ProjectStage, list: Project[], now: number): string {
  if (!list.length) return "还没有";
  if (stage === "finished") {
    const last = elapsed(Math.max(...list.map((p) => p.stageAt)), now);
    return last === "刚刚" ? "刚刚完结" : `最近 ${last}前完结`;
  }
  const longest = elapsed(Math.min(...list.map((p) => p.stageAt)), now);
  return longest === "刚刚" ? "刚刚开始" : `最久 ${longest}`;
}

/** 近 28 天: how many items were done each day, with the last week summed up. */
function ActivityCard({
  projects,
  activityOf,
  ready,
  now,
}: {
  projects: Project[];
  activityOf: Map<number, ProjectActivity>;
  ready: boolean;
  now: number;
}) {
  const days = useMemo(
    () =>
      lastDays(
        projects.flatMap((p) => activityOf.get(p.id)?.done ?? []),
        ACTIVITY_DAYS,
        now,
      ),
    [projects, activityOf, now],
  );
  const all = days.reduce((n, d) => n + d.n, 0);
  const week = days.slice(-7).reduce((n, d) => n + d.n, 0);
  const weekStart = days.at(-7)?.at ?? now;
  const moving = projects.filter((p) => (activityOf.get(p.id)?.lastActive ?? 0) >= weekStart).length;
  const best = Math.max(0, ...days.map((d) => d.n));
  return (
    <Card
      icon={<Activity />}
      title={`近 ${ACTIVITY_DAYS} 天`}
      aside={<span className="meta-mono whitespace-nowrap text-muted-foreground">完成 {all} 条</span>}
    >
      <div className="flex flex-1 flex-col gap-3 px-5 pt-1 pb-4">
        <div className="grid grid-cols-3 divide-x divide-foreground/[0.07]">
          <Stat label="近 7 天完成" value={week} icon={<DoneIcon className="size-3.5 shrink-0 text-done" />} />
          <Stat label="近 7 天有改动的项目" value={moving} icon={<span className="signal-dot size-1.5 shrink-0 rounded-full" />} />
          <Stat label="单日最多" value={best} icon={<Activity className="size-3.5 shrink-0 text-muted-foreground" />} />
        </div>
        <DayBars days={days} now={now} tips className={cn("h-20", !ready && "opacity-40")} />
        <div className="meta-mono flex justify-between text-[11px] text-muted-foreground">
          <span>{dayLabel(days[0]?.at ?? now, now)}</span>
          <span>今天</span>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 first:pl-0 last:pr-0">
      <span className="flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Columns of the items done each day, as tall as the busiest day; a day
 * with none is a low stub. With tips, each day tells its date and count.
 */
function DayBars({ days, now, tips, className }: { days: Day[]; now: number; tips?: boolean; className?: string }) {
  const max = Math.max(1, ...days.map((d) => d.n));
  return (
    <span className={cn("flex items-end gap-[3px]", className)}>
      {days.map((d, i) => {
        const bar = (
          <span key={d.at} className="group/bar flex h-full min-w-0 flex-1 flex-col justify-end">
            <span
              className={cn(
                "block w-full rounded-[3px] transition-[height,background-color] duration-500 ease-out motion-reduce:transition-none",
                d.n ? "bg-done group-hover/bar:bg-done/75" : "bg-foreground/[0.08]",
                i === days.length - 1 && !d.n && "bg-foreground/[0.14]",
              )}
              style={{ height: d.n ? `${Math.max((d.n / max) * 100, 10)}%` : 3 }}
            />
          </span>
        );
        if (!tips) return bar;
        return (
          <Tooltip key={d.at}>
            <TooltipTrigger asChild>{bar}</TooltipTrigger>
            <TooltipContent>
              {dayLabel(d.at, now)}
              <span className="meta-mono opacity-60">{d.n ? `完成 ${d.n} 条` : "没有完成"}</span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
}

/** A card for each project, by stage in their order; the finished ones fold away until opened. */
function ProjectGroups({
  projects,
  filter,
  activityOf,
  now,
}: {
  projects: Project[];
  filter: ProjectStage | null;
  activityOf: Map<number, ProjectActivity>;
  now: number;
}) {
  const [finishedOpen, setFinishedOpen] = useState(false);
  const groups = STAGES.map((info) => ({ info, list: projects.filter((p) => p.stage === info.value) })).filter((g) => g.list.length);
  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ info, list }) => {
        const finished = info.value === "finished";
        // Picked on its own, the finished stage shows its cards.
        const open = !finished || finishedOpen || filter === "finished";
        const heading = (
          <>
            <span className={cn("signal-chip grid size-5 shrink-0 place-items-center rounded-md", info.chip)}>
              <info.icon className="size-3" />
            </span>
            <span className="text-foreground">{info.label}</span>
            <span className="meta-mono rounded-full bg-foreground/[0.07] px-1.5 py-px font-normal text-muted-foreground">{list.length}</span>
          </>
        );
        return (
          <section key={info.value} className="flex flex-col gap-2">
            <h3 className="flex h-8 items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
              {finished && filter !== "finished" ? (
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setFinishedOpen(!finishedOpen)}
                  className="-ml-1 flex items-center gap-2 rounded-md py-1 pr-2 pl-1 transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <ChevronRight className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} />
                  {heading}
                  {!open && <span className="font-normal">点击展开</span>}
                </button>
              ) : (
                heading
              )}
              <span className="ml-1 h-px flex-1 bg-foreground/[0.07]" />
            </h3>
            {open && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
                {list.map((p) => (
                  <ProjectCard key={p.id} project={p} activity={activityOf.get(p.id)} now={now} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * A project at a glance: its icon, name and stage with how long it has
 * been at it; how far its items are; how many are in each status and
 * what was done in the last two weeks; when it last changed. A click
 * opens its queue; the right-click menu changes its stage.
 */
function ProjectCard({ project: p, activity, now }: { project: Project; activity: ProjectActivity | undefined; now: number }) {
  const info = stageInfo(p.stage);
  const all = total(p.counts);
  const days = useMemo(() => lastDays(activity?.done ?? [], CARD_DAYS, now), [activity, now]);
  const recent = days.reduce((n, d) => n + d.n, 0);
  const atStage = elapsed(p.stageAt, now);
  const last = activity ? elapsed(activity.lastActive, now) : "";
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={() => openProject(p.id)}
          className="group flex min-w-0 flex-col gap-3 rounded-lg bg-card p-4 text-left ring-1 ring-foreground/[0.07] transition-[box-shadow,translate] duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-1 hover:-translate-y-0.5 hover:shadow-lg hover:ring-foreground/15 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:animate-none motion-reduce:hover:translate-y-0"
        >
          <span className="flex w-full items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted ring-1 ring-foreground/[0.06]">
              <ProjectIcon project={p} className="size-5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate font-medium">{p.name}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-xs">
                <span className={cn("signal-chip inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 font-medium whitespace-nowrap", info.chip)}>
                  <info.icon className="size-3" />
                  {info.label}
                </span>
                <span className="meta-mono truncate text-muted-foreground" title={`${fullTime(p.stageAt)} 起`}>
                  {atStage === "刚刚" ? "刚刚" : `已 ${atStage}`}
                </span>
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <span className="text-xl font-semibold tracking-tight tabular-nums">
                {percent(p.counts.done, all)}
                <span className="ml-0.5 text-xs font-medium text-muted-foreground">%</span>
              </span>
              <span className="text-[11px] text-muted-foreground">完成</span>
            </span>
          </span>

          <ProgressBar counts={p.counts} className="w-full" />

          <span className="flex w-full items-end gap-3">
            <span className="flex min-w-0 flex-1 items-center gap-3 text-xs">
              {STATUS_ORDER.map((s) => (
                <span key={s.value} title={s.label} className="flex items-center gap-1">
                  <s.icon className={cn("size-3.5 shrink-0", s.text)} />
                  <span className={cn("tabular-nums", !p.counts[s.value] && "text-muted-foreground")}>{p.counts[s.value]}</span>
                </span>
              ))}
            </span>
            <span title={`近 ${CARD_DAYS} 天完成 ${recent} 条`} className="flex h-7 w-24 shrink-0">
              <DayBars days={days} now={now} className="h-full w-full" />
            </span>
          </span>

          <span className="flex w-full items-center gap-1.5 border-t border-foreground/[0.06] pt-2.5 text-xs text-muted-foreground">
            <History className="size-3.5 shrink-0" />
            <span className="truncate">{!activity ? "…" : last === "刚刚" ? "刚刚有改动" : `${last}前有改动`}</span>
            <span className="meta-mono ml-auto shrink-0">{all ? `共 ${all} 条` : "还没有改进点"}</span>
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => openProject(p.id)}>
          <ListTodo />
          打开队列
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            openProject(p.id);
            setView("overview");
          }}
        >
          <ChartPie />
          打开总览
        </ContextMenuItem>
        <ContextMenuSeparator />
        <StageContextSub project={p} />
        <ContextMenuItem onSelect={() => askProject(p)}>
          <SquarePen />
          编辑项目
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
