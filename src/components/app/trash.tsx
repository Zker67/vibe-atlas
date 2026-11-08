import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Flame, FolderKanban, RotateCcw, Trash2, X } from "lucide-react";
import type { TrashEntry } from "@/mygo";
import { isComposing, isTypingTarget, overlayOpen } from "@/lib/keys";
import { statusInfo } from "@/lib/labels";
import { PURGE_KEY } from "@/lib/purge-key";
import { dayKey, dayLabel, formatTime, fullTime, useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Scroller } from "@/components/ui/scroller";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { emptyTrash, purgeTrash, restoreTrash, setView, useAtlas } from "@/state/atlas";
import { askConfirm, showSettingsTab } from "@/state/dialogs";
import { IconButton } from "./icon-button";
import { TypeIcon } from "./item-marks";

const DAY = 24 * 60 * 60 * 1000;

function confirmPurge(entries: TrashEntry[]) {
  if (entries.length === 0) return;
  const ids = entries.map((e) => e.id);
  askConfirm({
    title: entries.length === 1 ? `彻底删除「${entries[0]!.item.title}」？` : `彻底删除 ${entries.length} 条改进点？`,
    description: "删除后无法恢复。",
    confirmText: entries.length === 1 ? "彻底删除" : `彻底删除 ${entries.length} 条`,
    destructive: true,
    onConfirm: () => purgeTrash(ids),
  });
}

function confirmEmpty(n: number) {
  askConfirm({
    title: "清空回收站？",
    description: `回收站里的 ${n} 条改进点会全部彻底删除，无法恢复。`,
    confirmText: "清空",
    destructive: true,
    onConfirm: emptyTrash,
  });
}

/** 「12 天后清除」: how long the trash still keeps an entry, or "" when it keeps it until emptied. */
function expiry(deletedAt: number, days: number, now: number): string {
  if (!days) return "";
  const left = deletedAt + days * DAY - now;
  if (left <= 0) return "即将清除";
  if (left < DAY) return "今天清除";
  return `${Math.ceil(left / DAY)} 天后清除`;
}

interface Selection {
  picked: ReadonlySet<number>;
  /** The entry the keys act from and move from. */
  cursor: number;
  /** Where Shift selects from. */
  anchor: number;
}

const NO_SELECTION: Selection = { picked: new Set(), cursor: 0, anchor: 0 };

/** The selection after a click on id, or the keys moving to it: alone, Ctrl adds or takes out, Shift selects from the anchor. */
function picking(s: Selection, id: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): Selection {
  const list = useAtlas.getState().trash;
  const add = e.ctrlKey || e.metaKey;
  const a = list.findIndex((x) => x.id === s.anchor);
  if (e.shiftKey && a >= 0) {
    const b = list.findIndex((x) => x.id === id);
    const [from, to] = a < b ? [a, b] : [b, a];
    const range = list.slice(from, to + 1).map((x) => x.id);
    return { picked: new Set(add ? [...s.picked, ...range] : range), cursor: id, anchor: s.anchor };
  }
  if (add) {
    const next = new Set(s.picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { picked: next, cursor: id, anchor: id };
  }
  return { picked: new Set([id]), cursor: id, anchor: id };
}

/**
 * The trash of every project, in the panel: the last deleted first, by day.
 * Click, Ctrl+click and Shift+click select; Enter restores, Delete deletes
 * for good, Esc goes back to the queue.
 */
export function TrashView() {
  const trash = useAtlas((s) => s.trash);
  const projects = useAtlas((s) => s.projects);
  const days = useAtlas((s) => s.settings?.trashDays ?? 30);
  const now = useNow();
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  // The keys read the selection from here: a key right after a click finds it already.
  const latest = useRef(selection);
  const select = useCallback((next: Selection) => {
    latest.current = next;
    setSelection(next);
  }, []);

  // Entries restored or deleted, here or in another window, leave the selection.
  const picked = useMemo(() => {
    const present = new Set(trash.map((e) => e.id));
    return new Set([...selection.picked].filter((id) => present.has(id)));
  }, [selection, trash]);
  const chosen = trash.filter((e) => picked.has(e.id));
  const cursor = selection.cursor;

  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const groups = useMemo(() => {
    const out: { key: string; label: string; entries: TrashEntry[] }[] = [];
    for (const e of trash) {
      const key = dayKey(e.deletedAt);
      const last = out.at(-1);
      if (last?.key === key) last.entries.push(e);
      else out.push({ key, label: dayLabel(e.deletedAt, now), entries: [e] });
    }
    return out;
  }, [trash, now]);

  const pick = (id: number, e: ReactMouseEvent) => select(picking(latest.current, id, e));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isComposing(e) || e.altKey || overlayOpen() || isTypingTarget(document.activeElement)) return;
      const list = useAtlas.getState().trash;
      // Only the entries still in the trash count: those restored or deleted leave.
      const present = new Set(list.map((x) => x.id));
      const s = { ...latest.current, picked: new Set([...latest.current.picked].filter((id) => present.has(id))) };
      const targets = () => list.filter((x) => (s.picked.size ? s.picked.has(x.id) : x.id === s.cursor));
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (mod) {
        if (key === "a" && list.length) {
          e.preventDefault();
          select({ ...s, picked: new Set(list.map((x) => x.id)) });
        }
        return;
      }
      switch (key) {
        case "ArrowDown":
        case "ArrowUp":
        case "j":
        case "k": {
          if (!list.length) return;
          e.preventDefault();
          const at = list.findIndex((x) => x.id === s.cursor);
          const delta = key === "ArrowDown" || key === "j" ? 1 : -1;
          const next = at < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, at + delta));
          select(picking(s, list[next]!.id, { shiftKey: e.shiftKey, ctrlKey: false, metaKey: false }));
          return;
        }
        case "Enter": {
          const back = targets();
          if (!back.length || (document.activeElement as HTMLElement | null)?.closest("button")) return;
          e.preventDefault();
          void restoreTrash(back.map((x) => x.id));
          return;
        }
        case "Delete":
          e.preventDefault();
          confirmPurge(targets());
          return;
        case "Escape":
          e.preventDefault();
          if (s.picked.size) select({ ...s, picked: new Set() });
          else setView("queue");
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  // The row the keys moved to stays in sight.
  useEffect(() => {
    document.querySelector(`[data-trash-entry="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Trash2 className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">回收站</h2>
        {trash.length > 0 && <span className="meta-mono text-muted-foreground">{trash.length}</span>}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => showSettingsTab("data")}
              className="rounded-sm px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {days ? `保留 ${days} 天` : "一直保留"}
            </button>
          </TooltipTrigger>
          <TooltipContent>在 设置 → 数据 里修改</TooltipContent>
        </Tooltip>
        <div className="ml-auto flex items-center gap-1">
          {picked.size > 0 ? (
            <div key="picked" className="flex items-center gap-1 animate-in duration-150 fade-in-0 slide-in-from-right-1">
              <span className="mr-1 text-xs text-muted-foreground">已选 {picked.size} 条</span>
              <Button variant="outline" size="sm" onClick={() => void restoreTrash([...picked])}>
                <RotateCcw />
                恢复
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => confirmPurge(chosen)}>
                <Flame />
                彻底删除
              </Button>
              <IconButton label="取消选择" shortcut="Esc" onClick={() => select({ ...latest.current, picked: new Set() })}>
                <X />
              </IconButton>
            </div>
          ) : (
            <Button
              key="empty"
              variant="ghost"
              size="sm"
              disabled={!trash.length}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => confirmEmpty(trash.length)}
            >
              <Flame />
              清空回收站
            </Button>
          )}
        </div>
      </div>

      {trash.length === 0 ? (
        <EmptyTrash days={days} />
      ) : (
        <>
          <Scroller className="flex-1" viewportClassName="px-2 pb-3">
            {/* Not a listbox: the keys of the window take a listbox for a popup and stand aside. */}
            <div role="list" aria-label="回收站" className="flex flex-col">
              {groups.map((g) => (
                <section key={g.key} className="flex flex-col">
                  <h3 className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">{g.label}</h3>
                  {g.entries.map((e) => (
                    <TrashRow
                      key={e.id}
                      entry={e}
                      project={projectName.get(e.item.projectId) ?? ""}
                      expires={expiry(e.deletedAt, days, now)}
                      selected={picked.has(e.id)}
                      cursor={cursor === e.id}
                      onPick={(ev) => pick(e.id, ev)}
                      onRestore={() => void restoreTrash(picked.has(e.id) ? [...picked] : [e.id])}
                      onPurge={() => confirmPurge(picked.has(e.id) ? chosen : [e])}
                    />
                  ))}
                </section>
              ))}
            </div>
          </Scroller>
          <div className="flex shrink-0 items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>Enter</Kbd> 恢复
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Delete</Kbd> 彻底删除
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Ctrl</Kbd>
              <Kbd>Z</Kbd> 撤销上一次删除
            </span>
            <span className="ml-auto flex items-center gap-1">
              <Kbd>Esc</Kbd> 返回
            </span>
          </div>
        </>
      )}
    </div>
  );
}

interface TrashRowProps {
  entry: TrashEntry;
  project: string;
  expires: string;
  selected: boolean;
  cursor: boolean;
  onPick(e: ReactMouseEvent): void;
  onRestore(): void;
  onPurge(): void;
}

function TrashRow({ entry, project, expires, selected, cursor, onPick, onRestore, onPurge }: TrashRowProps) {
  const { item } = entry;
  const status = statusInfo(item.status);
  const StatusIcon = status.icon;
  return (
    <div
      role="listitem"
      aria-current={selected || undefined}
      data-trash-entry={entry.id}
      onClick={onPick}
      onDoubleClick={onRestore}
      className={cn(
        "group signal-row flex min-h-12 cursor-default items-center gap-3 rounded-md px-3 py-1.5 transition-colors duration-150 animate-in fade-in-0 slide-in-from-top-1",
        selected ? "bg-accent" : "hover:bg-accent/50",
        cursor && !selected && "ring-1 ring-ring/40",
      )}
    >
      <TypeIcon type={item.type} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <StatusIcon aria-label={status.label} className={cn("size-3.5 shrink-0", status.text)} />
          <span className="truncate">{item.title}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {project && (
            <span className="flex min-w-0 items-center gap-1">
              <FolderKanban className="size-3 shrink-0" />
              <span className="truncate">{project}</span>
            </span>
          )}
          {entry.lifted > 0 && <span className="shrink-0">· {entry.lifted} 个子改进点已上移，恢复时放回</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 group-hover:hidden group-focus-within:hidden">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="meta-mono text-xs text-muted-foreground">{formatTime(entry.deletedAt)}</span>
          </TooltipTrigger>
          <TooltipContent>删除于 {fullTime(entry.deletedAt)}</TooltipContent>
        </Tooltip>
        {expires && <span className="text-xs text-muted-foreground/70">{expires}</span>}
      </div>
      <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex">
        <IconButton
          label="恢复到原来的位置"
          shortcut="Enter"
          onClick={(e) => {
            e.stopPropagation();
            onRestore();
          }}
        >
          <RotateCcw />
        </IconButton>
        <IconButton
          label="彻底删除"
          shortcut="Delete"
          className="hover:bg-destructive/10 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onPurge();
          }}
        >
          <Flame />
        </IconButton>
      </div>
    </div>
  );
}

function EmptyTrash({ days }: { days: number }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center animate-in duration-300 fade-in-0">
      <span className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground ring-1 ring-foreground/[0.06]">
        <Trash2 className="size-6" />
      </span>
      <h2 className="text-base font-semibold">回收站是空的</h2>
      <p className="max-w-72 text-sm text-muted-foreground">
        删除的改进点会先放在这里，{days ? `${days} 天后自动彻底删除` : "直到你彻底删除或清空"}。按住 <Kbd>{PURGE_KEY}</Kbd> 再删除，可以跳过回收站。
      </p>
    </div>
  );
}
