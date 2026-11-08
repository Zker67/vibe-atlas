import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { Atlas, type Session, type Source } from "@/mygo";
import { errorMessage } from "@/lib/api";
import { isComposing } from "@/lib/keys";
import { SOURCE_NAMES } from "@/lib/session-link";
import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { AgentIcon, agentName } from "./agent-icon";

/** The most rows the list draws at once; typing finds the others. */
const SHOWN = 200;

const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

interface SessionPickerProps {
  /** The source the settings name; the picker shows nothing without one. */
  source: Exclude<Source, "">;
  /** The project's folder: its sessions show first, with 「全部」 a Tab away; "" for all. */
  folder: string;
  onPick(session: Session): void;
  onClose(): void;
  className?: string;
}

/**
 * A list to pick one of the local sessions of the source set, to link an
 * item to: the newest first, those of the project's folder unless 「全部」
 * is on; typing narrows it by name. ↑ ↓ move, Enter picks, Tab switches
 * between the project and all, Esc closes. Read when it opens, never before.
 */
export function SessionPicker({ source, folder, onPick, onClose, className }: SessionPickerProps) {
  const [all, setAll] = useState(!folder);
  // What was read, and for which list: another one is still being read.
  const [loaded, setLoaded] = useState<{ key: string; list: Session[]; error: string } | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const name = SOURCE_NAMES[source];
  const key = `${source}\n${all ? "" : folder}`;
  const list = loaded?.key === key ? loaded.list : null;
  const error = loaded?.key === key ? loaded.error : "";

  useEffect(() => {
    let live = true;
    Atlas.listSessions(folder, all).then(
      (l) => live && setLoaded({ key, list: l ?? [], error: "" }),
      (e: unknown) => live && setLoaded({ key, list: [], error: errorMessage(e) }),
    );
    return () => {
      live = false;
    };
  }, [key, folder, all]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (list ?? []).filter((s) => !q || s.title.toLowerCase().includes(q) || s.id.toLowerCase().startsWith(q)),
    [list, q],
  );
  const shown = matches.slice(0, SHOWN);
  const at = shown.length === 0 ? -1 : Math.min(active, shown.length - 1);

  useEffect(() => {
    box.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e)) {
      if (e.key === "Escape") e.preventDefault();
      return;
    }
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        if (shown.length) setActive((at + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length);
        break;
      case "Enter":
        e.preventDefault();
        if (at >= 0) onPick(shown[at]!);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
      case "Tab":
        e.preventDefault();
        if (folder) {
          setAll((v) => !v);
          setActive(0);
        }
        break;
    }
  };

  const scope = (value: boolean, label: string) => (
    <button
      type="button"
      tabIndex={-1}
      aria-pressed={all === value}
      onMouseDown={keepFocus}
      onClick={() => {
        setAll(value);
        setActive(0);
      }}
      className={cn(
        "h-6 rounded-[5px] px-2 text-xs transition-colors duration-100",
        all === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  let empty = "";
  if (list === null) empty = `正在读取 ${name} 的会话…`;
  else if (error) empty = "";
  else if (list.length === 0) empty = all ? `本机没有找到 ${name} 的会话` : `这个项目的文件夹里还没有 ${name} 会话，按 Tab 看全部`;
  else if (shown.length === 0) empty = "没有名字相符的会话";

  return (
    <div className={cn("flex min-h-0 flex-col", className)} data-session-picker="">
      <div className="flex h-10 shrink-0 items-center gap-2 px-3 text-muted-foreground">
        <Search className="size-3.5 shrink-0" />
        <input
          autoFocus
          value={query}
          maxLength={100}
          spellCheck={false}
          aria-label={`搜索 ${name} 会话`}
          placeholder={`搜索 ${name} 会话`}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {folder && (
          <div className="flex shrink-0 items-center rounded-md bg-muted p-0.5" title="Tab 切换">
            {scope(false, "本项目")}
            {scope(true, "全部")}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="px-3 pb-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
      <div ref={box} role="listbox" aria-label={`${name} 会话`} className="flex max-h-64 min-h-0 flex-col overflow-y-auto px-1.5 pb-1.5">
        {shown.map((s, i) => (
          <button
            key={s.link}
            type="button"
            tabIndex={-1}
            role="option"
            aria-selected={i === at}
            data-row={i}
            title={s.cwd ? `${agentName(s.agent)} · ${s.cwd}` : agentName(s.agent)}
            onMouseDown={keepFocus}
            onMouseMove={() => setActive(i)}
            onClick={() => onPick(s)}
            className={cn("flex h-8 w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-sm", i === at && "bg-muted")}
          >
            <AgentIcon agent={s.agent} />
            <span className="min-w-0 flex-1 truncate">{s.title}</span>
            <span className="meta-mono shrink-0 text-xs text-muted-foreground">{formatTime(s.updatedAt)}</span>
          </button>
        ))}
        {empty && <p className="px-2 py-2 text-xs text-muted-foreground">{empty}</p>}
        {matches.length > SHOWN && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">还有 {matches.length - SHOWN} 个，输入文字搜索</p>
        )}
      </div>
    </div>
  );
}
