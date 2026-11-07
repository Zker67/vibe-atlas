import { useEffect, useState, type ReactNode } from "react";
import { Tabs } from "radix-ui";
import {
  AudioWaveform,
  BookOpen,
  CircleOff,
  Database,
  FolderOpen,
  Grip,
  Keyboard,
  Monitor,
  Moon,
  Palette,
  Sun,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Atlas, type Background, type Settings, type Theme } from "@/mygo";
import { errorMessage, run, runOk } from "@/lib/api";
import { acceleratorKeys, acceleratorOf } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAtlas } from "@/state/atlas";
import { openHelp, openSettings, showSettingsTab, useDialogs, type SettingsTab } from "@/state/dialogs";
import { NAV_ITEM, NavColumn, NavIndicator } from "./side-nav";

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
];

type EffectsChoice = "off" | Background;

const EFFECTS: { value: EffectsChoice; label: string; icon: typeof Sun }[] = [
  { value: "off", label: "关闭", icon: CircleOff },
  { value: "grid", label: "点阵网格", icon: Grip },
  { value: "waves", label: "点阵信号", icon: AudioWaveform },
];

/** Turns the effects off, or on with the background picked. */
async function chooseEffects(choice: EffectsChoice): Promise<Settings> {
  if (choice === "off") return Atlas.setEffects(false);
  await Atlas.setBackground(choice);
  return Atlas.setEffects(true);
}

function Keys({ accelerator }: { accelerator: string }) {
  return (
    <KbdGroup>
      {acceleratorKeys(accelerator).map((k, i) => (
        <Kbd key={i} className="h-6 min-w-6 px-1.5 text-foreground ring-1 ring-foreground/10">
          {k}
        </Kbd>
      ))}
    </KbdGroup>
  );
}


const TABS: { value: SettingsTab; label: string; icon: LucideIcon; description: string }[] = [
  { value: "capture", label: "快速记录", icon: Zap, description: "在任何软件里呼出小窗，记下一条就回去干活" },
  { value: "appearance", label: "外观", icon: Palette, description: "主题和视觉效果" },
  { value: "data", label: "数据", icon: Database, description: "所有内容只保存在这台电脑上，不联网" },
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
              <DialogDescription className="sr-only">快速记录的快捷键、外观、视觉效果和数据位置</DialogDescription>
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
                className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pt-5 pb-6 outline-none data-[state=active]:animate-in data-[state=active]:duration-200 data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-1"
              >
                <PanelHeader icon={t.icon} title={t.label} description={t.description} />
                <div className="flex flex-col gap-3">
                  {t.value === "capture" && <CapturePanel />}
                  {t.value === "appearance" && <AppearancePanel settings={settings} />}
                  {t.value === "data" && <DataPanel settings={settings} />}
                </div>
              </Tabs.Content>
            ))}
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  );
}

function PanelHeader({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <header className="mb-5 flex items-center gap-3 pr-8">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted ring-1 ring-foreground/[0.06]">
        <Icon className="size-4.5" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-base leading-tight font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </header>
  );
}

/** One setting: its name and what it does over its control. */
function SettingCard({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg bg-card p-4 ring-1 ring-foreground/[0.07]">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function CapturePanel() {
  return (
    <>
      <ShortcutSetting />
      <SettingCard title="其他快捷键" description="主窗口、快速记录小窗和 Markdown 编辑器的按键是固定的，按用途分好组放在使用说明里。">
        <div>
          <Button variant="outline" size="sm" onClick={() => openHelp("keys")}>
            <Keyboard />
            查看全部快捷键
          </Button>
        </div>
      </SettingCard>
    </>
  );
}

function AppearancePanel({ settings }: { settings: Settings }) {
  return (
    <>
      <SettingCard title="主题" description="顶栏右上角的按钮也能切换。">
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
      <SettingCard title="视觉效果" description="动态背景、毛玻璃和悬停辉光，会多占用显卡。">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          className="self-start"
          value={settings.effects ? settings.background : "off"}
          onValueChange={(v) => {
            if (v) void run(chooseEffects(v as EffectsChoice)).then((s) => s && useAtlas.setState({ settings: s }));
          }}
        >
          {EFFECTS.map((e) => (
            <ToggleGroupItem key={e.value} value={e.value}>
              <e.icon />
              {e.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingCard>
    </>
  );
}

function DataPanel({ settings }: { settings: Settings }) {
  return (
    <SettingCard title="数据文件夹" description="项目、模块和改进点都存在这里的 SQLite 文件里，每次修改立即写入。">
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

/**
 * The global shortcut of quick capture. While recording, the shortcut is
 * released, so that pressing the same keys again reaches the page.
 */
function ShortcutSetting() {
  const settings = useAtlas((s) => s.settings)!;
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!recording) return;
    void Atlas.pauseShortcut(true);
    // Set once a new shortcut is saving: saving it takes the shortcut back.
    let saving = false;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        setRecording(false);
        return;
      }
      const accelerator = acceleratorOf(e);
      if (!accelerator) return; // only modifiers so far
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        setError("快捷键需要包含 Ctrl、Alt 或 Win 键");
        return;
      }
      saving = true;
      setRecording(false);
      Atlas.setShortcut(accelerator).then(
        (s) => {
          useAtlas.setState({ settings: s });
          setError("");
        },
        (err: unknown) => setError(errorMessage(err)),
      );
    };
    // Leaving the window, or closing the dialog, gives the recording up.
    const onBlur = () => setRecording(false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      if (!saving) void Atlas.pauseShortcut(false);
    };
  }, [recording]);

  const reset = () => {
    Atlas.setShortcut(settings.defaultShortcut).then(
      (s) => {
        useAtlas.setState({ settings: s });
        setError("");
      },
      (err: unknown) => setError(errorMessage(err)),
    );
  };

  return (
    <SettingCard title="全局快捷键" description="在任何软件里按下它，呼出快速记录小窗。">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {recording ? (
            <span className="flex h-7 items-center rounded-md border border-dashed border-ring px-2.5 text-xs">请按下新的组合键，Esc 取消</span>
          ) : (
            <Keys accelerator={settings.shortcut} />
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError("");
              setRecording(!recording);
            }}
          >
            {recording ? "取消" : "修改"}
          </Button>
          {!recording && settings.shortcut !== settings.defaultShortcut && (
            <Button variant="ghost" size="sm" onClick={reset}>
              恢复默认（{settings.defaultShortcut}）
            </Button>
          )}
        </div>
        {(error || settings.shortcutError) && <p className="text-xs text-destructive">{error || settings.shortcutError}</p>}
      </div>
    </SettingCard>
  );
}
