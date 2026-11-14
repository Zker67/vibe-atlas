import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Boxes, Check, ChevronsUpDown, FolderKanban, Inbox, Link2, Plus, Search, type LucideIcon } from "lucide-react";
import { Atlas, events, type ItemType, type Module, type Project, type Source } from "@/mygo";
import { errorMessage } from "@/lib/api";
import { projectIcon } from "@/lib/icons";
import { isComposing } from "@/lib/keys";
import { nextType, typeInfo, UNSORTED } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";
import { TypeChip } from "@/components/app/item-marks";
import { AgentIcon } from "@/components/app/agent-icon";
import { EntityIcon } from "@/components/app/entity-icon";
import { SessionPicker } from "@/components/app/session-picker";
import { rememberSession, sessionLabel, useSessionLook } from "@/state/sessions";

// The notes' editor loads once the panel is up, so that it never delays
// the field taking the first keys.
const loadEditor = () => import("@/components/editor/markdown-editor");
const MarkdownEditor = lazy(() => loadEditor().then((m) => ({ default: m.MarkdownEditor })));

/** The choice after current in list, or before it, going round. */
function step<T>(list: T[], current: T, delta: number): T {
  if (list.length === 0) return current;
  const at = list.indexOf(current);
  return list[(Math.max(at, 0) + delta + list.length) % list.length]!;
}

type Picking = "project" | "module" | "session" | null;

/** What the panel says for a moment after an item is saved. */
interface Flash {
  key: number;
  where: string;
  count: number;
}

const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

/**
 * The quick capture panel, which the global shortcut shows over any app.
 * It is one line to type a title in; Shift+Enter opens the details below
 * it, and the project and module are picked or created from its bottom
 * bar. The window takes the height of what it shows (FitContent in app.go).
 */
export function CaptureApp() {
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(0);
  // The organization whose projects the panel lists: the main window's as
  // it shows, kept by a draft.
  const orgId = useRef(0);
  // The modules, with the project they belong to.
  const [loaded, setLoaded] = useState<{ projectId: number; modules: Module[] }>({ projectId: 0, modules: [] });
  const [moduleId, setModuleId] = useState(0);
  const [type, setType] = useState<ItemType>("improve");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [details, setDetails] = useState(false);
  const [picking, setPicking] = useState<Picking>(null);
  // Where sessions to link are read from, as the settings say; "" for none.
  const [sessionSource, setSessionSource] = useState<Source>("");
  const linkSession = useSessionLook(link);
  const [linkFocused, setLinkFocused] = useState(false);
  const linkInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<Flash | null>(null);
  const savedCount = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const detailsBox = useRef<HTMLDivElement>(null);
  // The draft, for the handlers of the panel showing again and of a save
  // that failed.
  const draft = useRef({ title, note, link });
  useEffect(() => {
    draft.current = { title, note, link };
  }, [title, note, link]);

  /** Fetches the organization's projects, keeping the one picked when it still exists. */
  const loadProjects = useCallback(async (want?: number) => {
    // Not known yet: the settings or the panel showing will tell.
    if (!orgId.current) return;
    const list = (await Atlas.projects()).filter((p) => p.orgId === orgId.current);
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
        setSessionSource(settings.sessionSource);
        orgId.current = settings.currentOrgId;
        await loadProjects(settings.currentProjectId);
      } catch (e) {
        setError(errorMessage(e));
        setReady(true);
      }
    })();
    const offShown = events.captureShown.on((state) => {
      savedCount.current = 0;
      setFlash(null);
      setError("");
      setPicking(null);
      const d = draft.current;
      const fresh = !d.title && !d.note.trim() && !d.link.trim();
      if (fresh) {
        // A fresh start: the defaults, and the organization and project the app suggests.
        orgId.current = state.orgId;
        setType("improve");
        setModuleId(0);
        setNote("");
        setLink("");
        setDetails(false);
      }
      // A draft keeps the organization, project and module it was written for.
      void loadProjects(fresh ? state.projectId : undefined).catch((e: unknown) => setError(errorMessage(e)));
      input.current?.focus();
    });
    const offChanged = events.changed.on(() => void loadProjects().catch(() => {}));
    const offSettings = events.settingsChanged.on((s) => setSessionSource(s.sessionSource));
    const onFocus = () => input.current?.focus();
    window.addEventListener("focus", onFocus);
    const prefetch = window.setTimeout(() => void loadEditor().catch(() => {}), 1000);
    return () => {
      offShown();
      offChanged();
      offSettings();
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(prefetch);
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

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2600);
    return () => window.clearTimeout(t);
  }, [flash]);

  const project = projects.find((p) => p.id === projectId);
  const modules = loaded.projectId === projectId ? loaded.modules : [];
  const moduleIds = [0, ...modules.map((m) => m.id)];
  const moduleName = modules.find((m) => m.id === moduleId)?.name ?? UNSORTED;

  const focusTitle = () => input.current?.focus();

  const pickProject = (id: number) => {
    if (id === projectId) return;
    setProjectId(id);
    setModuleId(0);
  };

  const closePicker = () => {
    setPicking(null);
    focusTitle();
  };
  const togglePicker = (kind: Exclude<Picking, null>) => {
    setError("");
    if (picking === kind) closePicker();
    else setPicking(kind);
  };

  /** Opens the details and goes to the notes; the editor takes the keys as it mounts. */
  const openDetails = () => {
    setPicking(null);
    if (!details) {
      setDetails(true);
      return;
    }
    detailsBox.current?.querySelector<HTMLElement>(".cm-content")?.focus();
  };
  /** Back to the title; empty details fold away. */
  const leaveDetails = () => {
    if (!note.trim() && !link.trim()) setDetails(false);
    focusTitle();
  };
  const toggleDetails = () => {
    if (details) {
      setDetails(false);
      focusTitle();
    } else openDetails();
  };

  const createProject = async (name: string) => {
    const p = await newProject(name, orgId.current);
    await loadProjects(p.id);
    setModuleId(0);
    closePicker();
  };
  const createModule = async (name: string) => {
    if (!projectId) return;
    const m = await Atlas.createModule(projectId, name);
    const list = await Atlas.modules(projectId);
    setLoaded({ projectId, modules: list });
    setModuleId(m.id);
    closePicker();
  };

  const openLink = (href: string) => void Atlas.openLink(href).catch((e: unknown) => setError(errorMessage(e)));

  // The panel empties at once, so the next item can follow without
  // waiting; one that failed to save comes back unless another was begun
  // since.
  const submit = async () => {
    const text = title.trim();
    if (!project) return;
    if (!text) {
      focusTitle();
      return;
    }
    const saved = { title, note, link, details };
    const where = `${project.name} / ${moduleName}`;
    setTitle("");
    setNote("");
    setLink("");
    setDetails(false);
    setPicking(null);
    setError("");
    focusTitle();
    try {
      await Atlas.captureItem({
        projectId: project.id,
        parentId: 0,
        moduleId,
        type,
        title: text,
        note: saved.note.trim() ? saved.note.trimEnd() : "",
        deeplink: saved.link.trim(),
      });
      savedCount.current += 1;
      setFlash({ key: Date.now(), where, count: savedCount.current });
    } catch (e) {
      setError(errorMessage(e));
      const now = draft.current;
      if (!now.title && !now.note && !now.link) {
        setTitle(saved.title);
        setNote(saved.note);
        setLink(saved.link);
        setDetails(saved.details || !!saved.note.trim() || !!saved.link.trim());
      }
    }
  };

  const onTitleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e)) {
      // Escape gives the candidate up; it must not close the panel.
      if (e.key === "Escape") e.preventDefault();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        if (e.shiftKey) openDetails();
        else void submit();
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

  // Ctrl+P and Ctrl+M open the lists from anywhere in the panel.
  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isComposing(e) || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (e.code === "KeyL" && sessionSource) {
      e.preventDefault();
      e.stopPropagation();
      togglePicker("session");
      return;
    }
    if (e.code !== "KeyP" && e.code !== "KeyM") return;
    e.preventDefault();
    e.stopPropagation();
    togglePicker(e.code === "KeyP" ? "project" : "module");
  };

  // In the notes and the link, before the editor sees them: Ctrl+Enter
  // saves, Escape goes back to the title rather than closing the panel.
  const onDetailsKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isComposing(e)) {
      if (e.key === "Escape") e.preventDefault();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      void submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      leaveDetails();
    }
  };

  if (ready && projects.length === 0) {
    return <NoProject onCreate={async (name) => loadProjects((await newProject(name, orgId.current)).id)} />;
  }

  return (
    <div
      className="flex flex-col bg-background text-foreground"
      data-capture-ready={ready ? "" : undefined}
      onKeyDownCapture={onPanelKey}
    >
      <div className="flex h-14 shrink-0 items-center gap-3 px-4">
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={keepFocus}
          onClick={() => setType(nextType(type))}
          className="shrink-0 rounded-md transition-transform duration-100 active:scale-95"
          title="切换类型（Tab）"
        >
          <TypeChip type={type} className="h-6 px-2 text-sm" />
        </button>
        <input
          ref={input}
          autoFocus
          data-capture-title=""
          value={title}
          maxLength={300}
          aria-label="标题"
          placeholder={`记一条${typeInfo(type).label}`}
          className="h-9 min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground/60"
          onChange={(e) => {
            setTitle(e.target.value);
            setError("");
          }}
          onKeyDown={onTitleKey}
        />
      </div>
      {error && (
        <p role="alert" className="-mt-2 px-4 pb-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {picking === "project" && (
        <Picker
          key="project"
          what="项目"
          choices={projects.map((p) => ({ id: p.id, name: p.name, icon: FolderKanban, own: projectIcon(p), open: p.counts.todo + p.counts.doing }))}
          value={projectId}
          onPick={(id) => {
            pickProject(id);
            closePicker();
          }}
          onCreate={createProject}
          onClose={closePicker}
        />
      )}
      {picking === "module" && (
        <Picker
          key="module"
          what="模块"
          choices={[
            { id: 0, name: UNSORTED, icon: Inbox },
            ...modules.map((m) => ({ id: m.id, name: m.name, icon: Boxes, own: m.icon, open: m.counts.todo + m.counts.doing })),
          ]}
          value={moduleId}
          onPick={(id) => {
            setModuleId(id);
            closePicker();
          }}
          onCreate={createModule}
          onClose={closePicker}
        />
      )}

      {picking === "session" && sessionSource && (
        <SessionPicker
          key="session"
          source={sessionSource}
          folder={project?.folderPath ?? ""}
          className="border-t animate-in duration-100 fade-in-0"
          onPick={(s) => {
            rememberSession(s);
            setLink(s.link);
            setError("");
            setDetails(true);
            closePicker();
          }}
          onClose={closePicker}
        />
      )}

      {details && (
        <div
          ref={detailsBox}
          data-capture-details=""
          className={cn("border-t animate-in duration-150 fade-in-0", picking && "hidden")}
          onKeyDownCapture={onDetailsKey}
        >
          <Suspense fallback={<div className="h-28" />}>
            <MarkdownEditor
              value={note}
              onChange={setNote}
              onOpenLink={openLink}
              placeholder="补充备注，支持 Markdown：标题、列表、任务框、代码块……"
              autoFocus
              className="capture-note px-4 pt-2"
            />
          </Suspense>
          <label className="flex h-10 items-center gap-2 border-t border-dashed px-4 text-muted-foreground">
            {linkSession ? <AgentIcon agent={linkSession.agent} /> : <Link2 className="size-3.5 shrink-0" />}
            <span className="relative flex h-full min-w-0 flex-1">
              <input
                ref={linkInput}
                data-capture-link=""
                value={link}
                spellCheck={false}
                aria-label="deeplink"
                placeholder="deeplink（可选）：AI 对话、文件或网页的链接"
                className={cn(
                  "h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60",
                  linkSession && !linkFocused && "text-transparent",
                )}
                onFocus={() => setLinkFocused(true)}
                onBlur={() => setLinkFocused(false)}
                onChange={(e) => {
                  setLink(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isComposing(e)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
              {/* A link to a session shows its name; the link itself shows while it is edited. */}
              {linkSession && !linkFocused && (
                <span className="pointer-events-none absolute inset-0 flex items-center truncate text-sm text-foreground">
                  {sessionLabel(linkSession)}
                </span>
              )}
            </span>
            {sessionSource && (
              <button
                type="button"
                tabIndex={-1}
                title="选择会话（Ctrl+L）"
                onMouseDown={keepFocus}
                onClick={() => togglePicker("session")}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors duration-100 hover:bg-muted hover:text-foreground"
              >
                <AgentIcon agent={sessionSource} className="size-3" />
                选择会话
              </button>
            )}
          </label>
        </div>
      )}

      <footer className="flex h-11 shrink-0 items-center gap-0.5 border-t px-2 text-xs text-muted-foreground">
        <PickButton
          icon={FolderKanban}
          own={project ? projectIcon(project) : ""}
          label={project?.name ?? ""}
          open={picking === "project"}
          title="项目：搜索、切换或新建（Ctrl+P）"
          onClick={() => togglePicker("project")}
        />
        <span className="text-muted-foreground/40">/</span>
        <PickButton
          icon={moduleId ? Boxes : Inbox}
          own={modules.find((m) => m.id === moduleId)?.icon ?? ""}
          label={moduleName}
          open={picking === "module"}
          title="模块：搜索、切换或新建（Ctrl+M）"
          onClick={() => togglePicker("module")}
        />
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {flash ? (
            <span key={flash.key} className="flex min-w-0 items-center gap-1.5 pr-2 animate-in duration-200 fade-in-0 slide-in-from-bottom-1">
              <Check className="size-3.5 shrink-0 text-done" />
              <span className="truncate">已记到 {flash.where}</span>
              {flash.count > 1 && <span className="meta-mono shrink-0">×{flash.count}</span>}
            </span>
          ) : picking ? (
            <>
              <Hint keys="↑ ↓">选择</Hint>
              <Hint keys="Enter">确定</Hint>
              <Hint keys="Esc">返回</Hint>
            </>
          ) : details ? (
            <>
              <Hint keys="Esc" onClick={leaveDetails}>
                返回标题
              </Hint>
              <Hint keys="Ctrl+Enter" onClick={() => void submit()}>
                保存
              </Hint>
            </>
          ) : (
            <>
              <Hint keys="Shift+Enter" onClick={toggleDetails}>
                详情
              </Hint>
              <Hint keys="Enter" onClick={() => void submit()}>
                保存
              </Hint>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

/** A key and what it does; a click does it too, when it can. */
function Hint({ keys, children, onClick }: { keys: string; children: ReactNode; onClick?(): void }) {
  const body = (
    <>
      <Kbd>{keys}</Kbd>
      {children}
    </>
  );
  if (!onClick) return <span className="flex h-7 shrink-0 items-center gap-1 px-1.5">{body}</span>;
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={keepFocus}
      onClick={onClick}
      className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 transition-colors duration-100 hover:bg-muted hover:text-foreground"
    >
      {body}
    </button>
  );
}

interface PickButtonProps {
  icon: LucideIcon;
  /** The project's or module's own icon, "" for icon. */
  own: string;
  label: string;
  open: boolean;
  title: string;
  onClick(): void;
}

/** The project or the module in the bottom bar; a click opens its list. */
function PickButton({ icon, own, label, open, title, onClick }: PickButtonProps) {
  return (
    <button
      type="button"
      tabIndex={-1}
      title={title}
      aria-expanded={open}
      onMouseDown={keepFocus}
      onClick={onClick}
      className={cn(
        "flex h-7 max-w-52 min-w-0 items-center gap-1.5 rounded-md px-2 font-medium text-foreground/80 transition-colors duration-100 hover:bg-muted hover:text-foreground",
        open && "bg-muted text-foreground",
      )}
    >
      <EntityIcon icon={own} fallback={icon} className="size-3.5 text-muted-foreground" />
      <span className="truncate">{label}</span>
      <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
    </button>
  );
}

interface Choice {
  id: number;
  name: string;
  icon: LucideIcon;
  /** Its own icon, "" for icon. */
  own?: string;
  /** How many of its items are not done yet. */
  open?: number;
}

interface PickerProps {
  what: string;
  choices: Choice[];
  value: number;
  onPick(id: number): void;
  /** Creates a choice of this name and picks it; rejects with what went wrong. */
  onCreate(name: string): Promise<void>;
  onClose(): void;
}

/**
 * A list to pick a project or a module from, in the panel: typing narrows
 * it, and a name that matches none can be created.
 */
function Picker({ what, choices, value, onPick, onCreate, onClose }: PickerProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(() => Math.max(
    choices.findIndex((c) => c.id === value),
    0,
  ));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const q = query.trim();
  const lower = q.toLowerCase();
  const shown = q ? choices.filter((c) => c.name.toLowerCase().includes(lower)) : choices;
  const canCreate = q !== "" && !choices.some((c) => c.name.toLowerCase() === lower);
  const rows = shown.length + (canCreate ? 1 : 0);
  const at = rows === 0 ? -1 : Math.min(active, rows - 1);

  useEffect(() => {
    list.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const choose = async (i: number) => {
    if (busy || i < 0) return;
    const choice = shown[i];
    if (choice) {
      onPick(choice.id);
      return;
    }
    setBusy(true);
    try {
      await onCreate(q);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e)) {
      if (e.key === "Escape") e.preventDefault();
      return;
    }
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        if (rows > 0) setActive((at + (e.key === "ArrowDown" ? 1 : -1) + rows) % rows);
        break;
      case "Enter":
        e.preventDefault();
        void choose(at);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
      case "Tab":
        e.preventDefault();
        break;
    }
  };

  const row = (i: number, content: ReactNode, key: string | number) => (
    <button
      key={key}
      type="button"
      tabIndex={-1}
      role="option"
      aria-selected={i === at}
      data-row={i}
      onMouseDown={keepFocus}
      onMouseMove={() => setActive(i)}
      onClick={() => void choose(i)}
      className={cn("flex h-8 w-full shrink-0 items-center gap-2 rounded-md px-2.5 text-left", i === at && "bg-muted")}
    >
      {content}
    </button>
  );

  return (
    <div className="border-t animate-in duration-100 fade-in-0" data-capture-picker={what}>
      <div className="flex h-10 items-center gap-2 px-4 text-muted-foreground">
        <Search className="size-3.5 shrink-0" />
        <input
          autoFocus
          value={query}
          maxLength={60}
          aria-label={`搜索或新建${what}`}
          placeholder={`搜索或新建${what}`}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setError("");
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {error && (
        <p role="alert" className="px-4 pb-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
      <div ref={list} role="listbox" aria-label={what} className="flex max-h-64 flex-col overflow-y-auto px-1.5 pb-1.5">
        {shown.map((c, i) =>
          row(
            i,
            <>
              <EntityIcon icon={c.own ?? ""} fallback={c.icon} className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {!!c.open && (
                <span className="meta-mono shrink-0 text-muted-foreground" title={`未完成 ${c.open} 条`}>
                  {c.open}
                </span>
              )}
              <Check className={cn("size-3.5 shrink-0", c.id !== value && "invisible")} />
            </>,
            c.id,
          ),
        )}
        {canCreate &&
          row(
            shown.length,
            <>
              <Plus className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                新建{what}「<span className="text-foreground">{q}</span>」
              </span>
              {busy && <span className="shrink-0 text-xs text-muted-foreground">正在新建…</span>}
            </>,
            "create",
          )}
        {rows === 0 && <p className="px-2.5 py-2 text-xs text-muted-foreground">还没有{what}，输入名字新建一个</p>}
      </div>
    </div>
  );
}

/** A project added from the panel, to the organization it lists. */
function newProject(name: string, orgId: number) {
  return Atlas.addProject({ name, folderPath: "", icon: "", orgId });
}

/** What the panel shows before the organization has any project: a field to create the first. */
function NoProject({ onCreate }: { onCreate(name: string): Promise<void> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => field.current?.focus();
    focus();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);

  const create = async () => {
    const text = name.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onCreate(text);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col bg-background text-foreground" data-capture-ready="">
      <div className="flex h-14 items-center gap-3 px-4">
        <FolderKanban className="size-5 shrink-0 text-muted-foreground" />
        <input
          ref={field}
          value={name}
          maxLength={60}
          aria-label="新项目的名字"
          placeholder="还没有项目：输入名字，新建第一个项目"
          className="h-9 min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground/60"
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (isComposing(e)) {
              if (e.key === "Escape") e.preventDefault();
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              void create();
            } else if (e.key === "Escape") {
              e.preventDefault();
              void Atlas.hideCapture();
            }
          }}
        />
      </div>
      {error && (
        <p role="alert" className="-mt-2 px-4 pb-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <footer className="flex h-11 items-center gap-1 border-t px-2 text-xs text-muted-foreground">
        <span className="px-2">新建后就能在这里快速记录</span>
        <div className="ml-auto flex items-center gap-1">
          <Hint keys="Enter" onClick={() => void create()}>
            新建
          </Hint>
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={keepFocus}
            onClick={() => void Atlas.showMain()}
            className="flex h-7 items-center gap-1 rounded-md px-1.5 transition-colors duration-100 hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3.5" />
            在主窗口新建
          </button>
        </div>
      </footer>
    </div>
  );
}
