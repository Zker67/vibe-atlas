import { useEffect, useState } from "react";
import { Tabs } from "radix-ui";
import {
  BookOpen,
  Check,
  CircleAlert,
  Database,
  FolderOpen,
  Keyboard,
  ListTree,
  Monitor,
  Moon,
  Palette,
  Pencil,
  RotateCcw,
  Sun,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Atlas, type Settings, type Theme } from "@/mygo";
import { errorMessage, run, runOk } from "@/lib/api";
import { acceleratorKeys, acceleratorOf } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Scroller } from "@/components/ui/scroller";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAtlas } from "@/state/atlas";
import { openHelp, openSettings, showSettingsTab, useDialogs, type SettingsTab } from "@/state/dialogs";
import { LookSettings } from "./look-settings";
import { SettingCard } from "./setting-card";
import { NAV_ITEM, NavColumn, NavIndicator } from "./side-nav";

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
];

const TABS: { value: SettingsTab; label: string; icon: LucideIcon }[] = [
  { value: "capture", label: "快速记录", icon: Zap },
  { value: "items", label: "改进点", icon: ListTree },
  { value: "appearance", label: "外观", icon: Palette },
  { value: "data", label: "数据", icon: Database },
];

export function SettingsDialog() {
  const open = useDialogs((s) => s.settings);
  const settings = useAtlas((s) => s.settings);
  const tab = useDialogs((s) => s.settingsTab);
  const at = TABS.findIndex((t) => t.value === tab);
  return (
    <Dialog open={open} onOpenChange={openSettings}>
      <DialogContent className="flex h-[min(32rem,85vh)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <Tabs.Root
          orientation="vertical"
          value={tab}
          onValueChange={(v) => showSettingsTab(v as SettingsTab)}
          className="flex min-h-0 min-w-0 flex-1"
        >
          <NavColumn>
            <DialogHeader className="px-2.5 pt-1">
              <DialogTitle>设置</DialogTitle>
              <DialogDescription className="sr-only">快速记录的快捷键、子改进点的链接、外观（主题、背景、毛玻璃、透明度）和数据位置</DialogDescription>
            </DialogHeader>
            <Tabs.List aria-label="设置分类" className="relative flex flex-col gap-0.5">
              <NavIndicator index={at} />
              {TABS.map((t) => (
                <Tabs.Trigger key={t.value} value={t.value} className={NAV_ITEM}>
                  <t.icon />
                  {t.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <button type="button" className={cn(NAV_ITEM, "mt-auto")} onClick={() => openHelp()}>
              <BookOpen />
              <span className="flex-1">使用说明</span>
              <span className="meta-mono opacity-70">F1</span>
            </button>
          </NavColumn>
          {settings &&
            TABS.map((t) => (
              <Tabs.Content
                key={t.value}
                value={t.value}
                className="flex min-h-0 min-w-0 flex-1 flex-col outline-none data-[state=active]:animate-in data-[state=active]:duration-200 data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-1"
              >
                <Scroller always className="flex-1" viewportClassName="px-6 pt-12 pb-6">
                  <div className="flex flex-col gap-3">
                    {t.value === "capture" && <CapturePanel />}
                    {t.value === "items" && <ItemsPanel settings={settings} />}
                    {t.value === "appearance" && <AppearancePanel settings={settings} />}
                    {t.value === "data" && <DataPanel settings={settings} />}
                  </div>
                </Scroller>
              </Tabs.Content>
            ))}
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  );
}

function CapturePanel() {
  return (
    <>
      <ShortcutSetting />
      <SettingCard title="其他快捷键">
        <div>
          <Button variant="outline" size="sm" onClick={() => openHelp("keys")}>
            <Keyboard />
            在使用说明中查看
          </Button>
        </div>
      </SettingCard>
    </>
  );
}

function ItemsPanel({ settings }: { settings: Settings }) {
  return (
    <SettingCard
      title="子改进点沿用上级的链接"
      description="子改进点没有自己的链接时，打开最近一层有链接的上级的链接。关闭后每条只打开自己的链接。"
      action={
        <Switch
          aria-label="子改进点沿用上级的链接"
          checked={settings.shareLinks}
          onCheckedChange={(on) => void run(Atlas.setShareLinks(on)).then((s) => s && useAtlas.setState({ settings: s }))}
        />
      }
    />
  );
}

function AppearancePanel({ settings }: { settings: Settings }) {
  return (
    <>
      <SettingCard title="主题">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          className="self-start"
          value={settings.theme}
          onValueChange={(v) => {
            if (v) void run(Atlas.setTheme(v as Theme)).then((s) => s && useAtlas.setState({ settings: s }));
          }}
        >
          {THEMES.map((t) => (
            <ToggleGroupItem key={t.value} value={t.value}>
              <t.icon />
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingCard>
      <LookSettings settings={settings} />
    </>
  );
}

function DataPanel({ settings }: { settings: Settings }) {
  return (
    <SettingCard title="数据文件夹">
      <p className="selectable rounded-md bg-muted px-2.5 py-2 font-mono text-xs break-all">{settings.dataDir}</p>
      <div>
        <Button variant="outline" size="sm" onClick={() => void runOk(Atlas.openDataFolder())}>
          <FolderOpen />
          打开数据文件夹
        </Button>
      </div>
    </SettingCard>
  );
}

/** The modifiers held in a key event, as key caps. */
function heldModifiers(e: KeyboardEvent): string[] {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push(navigator.platform.startsWith("Mac") ? "Cmd" : "Win");
  return mods;
}

/** Key caps, each popping in as it appears. */
function KeyCaps({ keys }: { keys: string[] }) {
  return (
    <KbdGroup className="gap-1">
      {keys.map((k, i) => (
        <Kbd
          key={`${i}-${k}`}
          className="h-6 min-w-6 bg-background px-1.5 text-foreground shadow-xs ring-1 ring-foreground/10 animate-in duration-150 fade-in-0 zoom-in-90"
        >
          {k}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

/**
 * The global shortcut of quick capture, as a field that records the keys
 * pressed. While recording, the shortcut is released, so that pressing the
 * same keys again reaches the page.
 */
function ShortcutSetting() {
  const settings = useAtlas((s) => s.settings)!;
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(false), 1600);
    return () => window.clearTimeout(t);
  }, [saved]);

  useEffect(() => {
    if (!recording) return;
    void Atlas.pauseShortcut(true);
    // Set once a new shortcut is saving: saving it takes the shortcut back.
    let saving = false;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "keyup") {
        setHeld(heldModifiers(e));
        return;
      }
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        setRecording(false);
        return;
      }
      const accelerator = acceleratorOf(e);
      if (!accelerator) {
        setHeld(heldModifiers(e)); // only modifiers so far
        return;
      }
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        setHeld([]);
        setError("需要包含 Ctrl、Alt 或 Win 键");
        return;
      }
      saving = true;
      setRecording(false);
      Atlas.setShortcut(accelerator).then(
        (s) => {
          useAtlas.setState({ settings: s });
          setError("");
          setSaved(true);
        },
        (err: unknown) => setError(errorMessage(err)),
      );
    };
    // Leaving the window, or closing the dialog, gives the recording up.
    const onBlur = () => setRecording(false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", onBlur);
      if (!saving) void Atlas.pauseShortcut(false);
    };
  }, [recording]);

  const reset = () => {
    Atlas.setShortcut(settings.defaultShortcut).then(
      (s) => {
        useAtlas.setState({ settings: s });
        setError("");
        setSaved(true);
      },
      (err: unknown) => setError(errorMessage(err)),
    );
  };

  const message = error || settings.shortcutError;
  return (
    <SettingCard title="快速记录快捷键" description="在任何软件中打开快速记录。">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label={recording ? "正在录制快捷键，按 Esc 取消" : `快速记录快捷键 ${settings.shortcut}，点击修改`}
            onClick={() => {
              setError("");
              setHeld([]);
              setRecording(!recording);
            }}
            onBlur={() => setRecording(false)}
            className={cn(
              "flex h-10 w-72 max-w-full items-center gap-2.5 rounded-lg bg-muted/60 px-3 text-left ring-1 ring-foreground/10 transition-[box-shadow,background-color] duration-200 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60",
              recording && "bg-background ring-2 ring-ring/70 hover:bg-background",
              !recording && message && "ring-destructive/50",
            )}
          >
            {recording ? (
              <>
                <span className="signal-dot size-2 shrink-0 animate-pulse rounded-full [--chip:var(--bug)]" />
                {held.length > 0 ? (
                  <KeyCaps keys={held} />
                ) : (
                  <span className="text-muted-foreground animate-in fade-in-0">按下新的快捷键</span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Kbd>Esc</Kbd>
                  取消
                </span>
              </>
            ) : (
              <>
                <Keyboard className="size-4 shrink-0 text-muted-foreground" />
                <KeyCaps keys={acceleratorKeys(settings.shortcut)} />
                {saved ? (
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-done animate-in fade-in-0">
                    <Check className="size-3.5" />
                    已保存
                  </span>
                ) : (
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Pencil className="size-3.5" />
                    修改
                  </span>
                )}
              </>
            )}
          </button>
          {!recording && settings.shortcut !== settings.defaultShortcut && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" title={`恢复为 ${settings.defaultShortcut}`} onClick={reset}>
              <RotateCcw />
              恢复默认
            </Button>
          )}
        </div>
        {message && (
          <p className="flex items-center gap-1.5 text-xs text-destructive animate-in fade-in-0">
            <CircleAlert className="size-3.5 shrink-0" />
            {message}
          </p>
        )}
      </div>
    </SettingCard>
  );
}
