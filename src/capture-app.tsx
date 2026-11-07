import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, FolderKanban, Plus } from "lucide-react";
import { Atlas, events, type ItemType, type Module, type Project } from "@/mygo";
import { errorMessage } from "@/lib/api";
import { isComposing } from "@/lib/keys";
import { nextType, typeInfo, UNSORTED } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { TypeChip, TypeIcon } from "@/components/app/item-marks";

/** The choice after current in list, or before it, going round. */
function step<T>(list: T[], current: T, delta: number): T {
  if (list.length === 0) return current;
  const at = list.indexOf(current);
  return list[(Math.max(at, 0) + delta + list.length) % list.length]!;
}

interface Saved {
  id: number;
  title: string;
  type: ItemType;
  project: string;
}

/**
 * The quick capture panel, which the global shortcut shows over any app.
 * Everything works from the keyboard: the field never loses it.
 */
export function CaptureApp() {
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(0);
  // The modules, with the project they belong to.
  const [loaded, setLoaded] = useState<{ projectId: number; modules: Module[] }>({ projectId: 0, modules: [] });
  const [moduleId, setModuleId] = useState(0);
  const [type, setType] = useState<ItemType>("improve");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Saved[]>([]);
  const input = useRef<HTMLInputElement>(null);
  // The draft, for the handler of the panel showing again.
  const titleRef = useRef(title);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  /** Fetches the projects, keeping the one picked when it still exists. */
  const loadProjects = useCallback(async (want?: number) => {
    const list = await Atlas.projects();
    setProjects(list);
    setProjectId((current) => {
      const pick = want || current;
      return list.some((p) => p.id === pick) ? pick : (list[0]?.id ?? 0);
    });
    setReady(true);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const settings = await Atlas.settings();
        await loadProjects(settings.currentProjectId);
      } catch (e) {
        setError(errorMessage(e));
        setReady(true);
      }
    })();
    const offShown = events.captureShown.on((state) => {
      setSaved([]);
      setError("");
      if (!titleRef.current) {
        // A fresh start: the defaults, and the project the app suggests.
        setType("improve");
        setModuleId(0);
      }
      void loadProjects(state.projectId).catch((e: unknown) => setError(errorMessage(e)));
      input.current?.focus();
    });
    const offChanged = events.changed.on(() => void loadProjects().catch(() => {}));
    const onFocus = () => input.current?.focus();
    window.addEventListener("focus", onFocus);
    return () => {
      offShown();
      offChanged();
      window.removeEventListener("focus", onFocus);
    };
  }, [loadProjects]);

  // The modules of the project picked, fetched again as they change; a
  // module that is gone goes back to none.
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    const load = () =>
      Atlas.modules(projectId).then(
        (list) => {
          if (!live) return;
          setLoaded({ projectId, modules: list });
          setModuleId((m) => (list.some((x) => x.id === m) ? m : 0));
        },
        () => {},
      );
    void load();
    // Renaming or deleting a module reports no project (0).
    const off = events.changed.on((c) => {
      if (c.projectId === projectId || c.projectId === 0) void load();
    });
    return () => {
      live = false;
      off();
    };
  }, [projectId]);

  const project = projects.find((p) => p.id === projectId);
  const modules = loaded.projectId === projectId ? loaded.modules : [];
  const moduleIds = [0, ...modules.map((m) => m.id)];

  const pickProject = (id: number) => {
    if (id === projectId) return;
    setProjectId(id);
    setModuleId(0);
  };

  // The field clears at once, so the next title can follow without waiting;
  // a title that failed to save comes back unless another was typed since.
  const submit = async () => {
    const text = title.trim();
    if (!text || !project) return;
    setTitle("");
    try {
      const item = await Atlas.captureItem({ projectId: project.id, parentId: 0, moduleId, type, title: text });
      setSaved((list) => [{ id: item.id, title: item.title, type: item.type, project: project.name }, ...list].slice(0, 4));
      setError("");
    } catch (e) {
      setError(errorMessage(e));
      setTitle((now) => now || text);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e)) {
      // Escape gives the candidate up; it must not close the panel.
      if (e.key === "Escape") e.preventDefault();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        void submit();
        break;
      case "Escape":
        e.preventDefault();
        void Atlas.hideCapture();
        break;
      case "Tab":
        e.preventDefault();
        setType(nextType(type, e.shiftKey));
        break;
      case "ArrowUp":
      case "ArrowDown": {
        if (e.altKey || e.shiftKey) return;
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        if (mod) setModuleId(step(moduleIds, moduleId, delta));
        else
          pickProject(
            step(
              projects.map((p) => p.id),
              projectId,
              delta,
            ),
          );
        break;
      }
    }
  };

  if (ready && projects.length === 0) {
    return <NoProject error={error} />;
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground" data-capture-ready={ready ? "" : undefined}>
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setType(nextType(type))}
          className="shrink-0 rounded-md"
          title="切换类型（Tab）"
        >
          <TypeChip type={type} className="h-6 px-2 text-sm" />
        </button>
        <input
          ref={input}
          autoFocus
          value={title}
          maxLength={300}
          aria-label="标题"
          placeholder={`记一条${typeInfo(type).label}，按 Enter 保存`}
          className="h-8 min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground/70"
          onChange={(e) => {
            setTitle(e.target.value);
            setError("");
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {error && <p className="-mt-1 px-4 pb-2 text-xs text-destructive">{error}</p>}

      <div className="flex flex-col gap-2 border-t px-4 py-3">
        <ChipRow
          label="项目"
          keys="↑ ↓"
          options={projects.map((p) => ({ id: p.id, name: p.name }))}
          value={projectId}
          onPick={pickProject}
        />
        <ChipRow
          label="模块"
          keys="Ctrl+↑ ↓"
          options={[{ id: 0, name: UNSORTED }, ...modules.map((m) => ({ id: m.id, name: m.name }))]}
          value={moduleId}
          onPick={setModuleId}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden border-t px-4 py-2">
        {saved.length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground">记下的会立即出现在主窗口的队列里；备注和链接之后在主窗口补。</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {saved.map((s, i) => (
              <li key={s.id} className={cn("flex h-7 items-center gap-2 text-sm", i > 0 && "text-muted-foreground")}>
                <Check className="size-3.5 shrink-0 text-done" />
                <TypeIcon type={s.type} />
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">已记到「{s.project}」</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
        <Hint keys="Enter">保存</Hint>
        <Hint keys="Tab">类型</Hint>
        <Hint keys="↑ ↓">项目</Hint>
        <Hint keys="Ctrl+↑ ↓">模块</Hint>
        <Hint keys="Esc">关闭</Hint>
      </footer>
    </div>
  );
}

function Hint({ keys, children }: { keys: string; children: string }) {
  return (
    <span className="flex items-center gap-1">
      <Kbd>{keys}</Kbd>
      {children}
    </span>
  );
}

interface ChipRowProps {
  label: string;
  keys: string;
  options: { id: number; name: string }[];
  value: number;
  onPick(id: number): void;
}

/** A row of choices; the keys move along it, the mouse picks too. */
function ChipRow({ label, keys, options, value, onPick }: ChipRowProps) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    row.current?.querySelector<HTMLElement>(`[data-choice="${value}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div ref={row} className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            tabIndex={-1}
            data-choice={o.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(o.id)}
            className={cn(
              "h-6 max-w-40 shrink-0 truncate rounded-md px-2 text-xs transition-colors duration-100",
              o.id === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {o.name}
          </button>
        ))}
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground/70">{keys}</span>
    </div>
  );
}

/** What the panel says before any project exists. */
function NoProject({ error }: { error: string }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const focus = () => button.current?.focus();
    focus();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground"
      data-capture-ready=""
      onKeyDown={(e) => {
        if (e.key === "Escape" && !isComposing(e)) {
          e.preventDefault();
          void Atlas.hideCapture();
        }
      }}
    >
      <FolderKanban className="size-8 text-muted-foreground" />
      <p>还没有项目。先在主窗口建一个，就能在这里快速记录了。</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button ref={button} onClick={() => void Atlas.showMain()}>
        <Plus />
        打开主窗口新建项目
      </Button>
    </div>
  );
}
