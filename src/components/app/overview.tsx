import { useMemo, useState, type ReactNode } from "react";
import { Boxes, CircleCheck, CircleDot, History, Inbox } from "lucide-react";
import type { Counts, Item, Overview as OverviewData, Project } from "@/mygo";
import { cn } from "@/lib/utils";
import { useDebouncedSave } from "@/lib/debounce";
import { TYPES, UNSORTED } from "@/lib/labels";
import { dayKey, dayLabel, elapsed, useNow } from "@/lib/time";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { Button } from "@/components/ui/button";
import { Scroller } from "@/components/ui/scroller";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { TypeChip, TypeIcon } from "./item-marks";

const HISTORY_PAGE = 100;

/** The project as a whole, summed up from its items. */
export function Overview({ project }: { project: Project }) {
  const overview = useAtlas((s) => (s.overview?.projectId === project.id ? s.overview : null));
  return (
    <Scroller className="flex-1">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-5">
        <Description key={project.id} project={project} />
        {!overview ? null : overview.totals.todo + overview.totals.doing + overview.totals.done === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <Inbox className="size-8 opacity-50" />
            <p className="max-w-full break-words text-base font-medium text-foreground">「{project.name}」的故事，从第一条开始</p>
            <p>记下的每一条都会汇总到这里</p>
          </div>
        ) : (
          <Summary overview={overview} />
        )}
      </div>
    </Scroller>
  );
}

function Description({ project }: { project: Project }) {
  const { schedule, flush } = useDebouncedSave((text) => {
    if (useAtlas.getState().projects.some((p) => p.id === project.id)) void setProjectDescription(project.id, text);
  });

  return (
    <section>
      <SectionTitle>项目说明</SectionTitle>
      <MarkdownEditor
        className="min-h-24 rounded-lg border px-3 py-1.5 transition-colors hover:border-ring/60 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30"
        value={project.description}
        placeholder="这个项目是什么、目标和约定……用 Markdown 写，边写边预览"
        onChange={schedule}
        onBlur={flush}
        onOpenLink={openLink}
      />
    </section>
  );
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex min-h-7 items-center gap-2">
      <h2 className="text-xs font-medium text-muted-foreground">{children}</h2>
      {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
    </div>
  );
}

function total(c: Counts): number {
  return c.todo + c.doing + c.done;
}

/** How far a set of items is: done, then doing, over all of them. */
function ProgressBar({ counts, className }: { counts: Counts; className?: string }) {
  const all = total(counts);
  const pct = (n: number) => `${all ? (n / all) * 100 : 0}%`;
  return (
    <div className={cn("flex h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <div className="bg-done transition-[width] duration-300" style={{ width: pct(counts.done) }} />
      <div className="bg-doing transition-[width] duration-300" style={{ width: pct(counts.doing) }} />
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
      <section className="grid grid-cols-4 gap-3">
        <Stat label="全部" value={all} />
        <Stat label="待办" value={totals.todo} />
        <Stat label="进行中" value={totals.doing} tone="text-doing" />
        <Stat label="完成" value={totals.done} tone="text-done" hint={`${Math.round((totals.done / all) * 100)}%`} />
        <ProgressBar counts={totals} className="col-span-4" />
      </section>

      <div className="grid grid-cols-[3fr_2fr] gap-6 max-lg:grid-cols-1">
        <section>
          <SectionTitle>模块进度</SectionTitle>
          <div className="flex flex-col">
            {overview.modules.map((m) => (
              <button
                key={m.moduleId}
                type="button"
                onClick={() => openQueue({ module: m.moduleId })}
                className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {m.moduleId ? (
                    <Boxes className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Inbox className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{m.moduleId ? m.name : UNSORTED}</span>
                </span>
                <ProgressBar counts={m.counts} />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {m.counts.done}/{total(m.counts)}
                </span>
              </button>
            ))}
            {overview.modules.length === 0 && <p className="px-2 text-xs text-muted-foreground">还没有模块。</p>}
          </div>
        </section>

        <section>
          <SectionTitle>类型</SectionTitle>
          <div className="flex flex-col">
            {overview.types.map((t) => {
              const open = t.counts.todo + t.counts.doing;
              return (
                <button
                  key={t.type}
                  type="button"
                  onClick={() => openQueue({ type: t.type })}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
                >
                  <TypeChip type={t.type} className="w-16 justify-center" />
                  <span className="tabular-nums">{total(t.counts)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{open ? `${open} 条没完成` : "全部完成"}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {overview.doing.length > 0 && (
        <section>
          <SectionTitle>
            <span className="flex items-center gap-1.5">
              <CircleDot className="size-3.5 text-doing" />
              进行中 {overview.doing.length}
            </span>
          </SectionTitle>
          <ItemList items={overview.doing} time="started" />
        </section>
      )}

      <DoneHistory done={overview.done} />
    </>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: number; tone?: string; hint?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className={cn("text-2xl font-semibold tracking-tight tabular-nums", tone)}>{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

function useModuleNames() {
  const modules = useAtlas((s) => s.modules);
  return useMemo(() => new Map(modules.map((m) => [m.id, m.name])), [modules]);
}

/** Rows of items; a click shows the item in the queue. */
function ItemList({ items, time }: { items: Item[]; time: "started" | "done" }) {
  const names = useModuleNames();
  const now = useNow();
  return (
    <div className="flex flex-col">
      {items.map((item) => {
        const at = time === "started" ? item.startedAt : item.doneAt;
        const d = new Date(at);
        const label =
          time === "started"
            ? elapsed(at, now) === "刚刚"
              ? "刚开始"
              : `进行了 ${elapsed(at, now)}`
            : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => showItem(item)}
            className="flex h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-accent/60"
          >
            <TypeIcon type={item.type} />
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <span className="max-w-32 shrink-0 truncate text-xs text-muted-foreground">{names.get(item.moduleId) ?? UNSORTED}</span>
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{label}</span>
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
    <section>
      <SectionTitle
        aside={
          done.length > 0 && (
            <>
              <Select value={String(moduleFilter)} onValueChange={(v) => setModule(v === "all" ? "all" : Number(v))}>
                <SelectTrigger size="sm" aria-label="按模块筛选" className="max-w-40">
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
                  <SelectItem value="all">全部类型</SelectItem>
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
        <span className="flex items-center gap-1.5">
          <History className="size-3.5" />
          完成记录
        </span>
      </SectionTitle>
      {done.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">完成的改进点会按日期记在这里。</p>
      ) : shown.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">没有符合筛选条件的完成记录。</p>
      ) : (
        <div className="flex flex-col gap-3">
          {days.map((day) => (
            <div key={day.key}>
              <div className="flex items-center gap-2 px-2 pb-1 text-xs font-medium">
                <CircleCheck className="size-3.5 text-done" />
                {dayLabel(day.at)}
                <span className="font-normal text-muted-foreground">{day.items.length} 条</span>
              </div>
              <ItemList items={day.items} time="done" />
            </div>
          ))}
          {shown.length > limit && (
            <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => setLimit(limit + HISTORY_PAGE)}>
              再显示 {Math.min(HISTORY_PAGE, shown.length - limit)} 条
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
