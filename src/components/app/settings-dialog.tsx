import { useEffect, useState, type ReactNode } from "react";
import { AudioWaveform, CircleOff, FolderOpen, Grip, Monitor, Moon, Sun } from "lucide-react";
import { Atlas, type Background, type Settings, type Theme } from "@/mygo";
import { errorMessage, run, runOk } from "@/lib/api";
import { acceleratorKeys, acceleratorOf } from "@/lib/keys";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAtlas } from "@/state/atlas";
import { openSettings, useDialogs } from "@/state/dialogs";

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

const MAIN_KEYS: [string, string][] = [
  ["N", "新增一条"],
  ["↑ ↓", "选择上一条、下一条"],
  ["Space", "标为完成，或重新打开"],
  ["S", "开始进行，或退回待办"],
  ["C", "复制给 AI"],
  ["O", "打开链接"],
  ["Enter", "编辑标题"],
  ["Delete", "删除"],
  ["Esc", "取消选择"],
  ["Ctrl+,", "打开设置"],
];

const CAPTURE_KEYS: [string, string][] = [
  ["Enter", "保存，接着记下一条"],
  ["Tab", "切换类型"],
  ["↑ ↓", "切换项目"],
  ["Ctrl+↑ ↓", "切换模块"],
  ["Esc", "关闭小窗"],
];

function Keys({ accelerator }: { accelerator: string }) {
  return (
    <KbdGroup>
      {acceleratorKeys(accelerator).map((k, i) => (
        <Kbd key={i}>{k}</Kbd>
      ))}
    </KbdGroup>
  );
}

export function SettingsDialog() {
  const open = useDialogs((s) => s.settings);
  const settings = useAtlas((s) => s.settings);
  return (
    <Dialog open={open} onOpenChange={openSettings}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription className="sr-only">快速记录的快捷键、外观、视觉效果和数据位置</DialogDescription>
        </DialogHeader>
        {settings && (
          <div className="flex flex-col gap-5">
            <ShortcutSetting />
            <Row title="外观">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
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
            </Row>
            <Row title="视觉效果">
              <div className="flex min-w-0 flex-col items-start gap-1.5">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
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
                <p className="text-xs text-muted-foreground">动态背景、毛玻璃和悬停辉光，会多占用显卡</p>
              </div>
            </Row>
            <Row title="数据">
              <div className="flex min-w-0 flex-col items-start gap-1.5">
                <p className="text-xs text-muted-foreground">只保存在这台电脑上：</p>
                <p className="selectable w-full font-mono text-xs break-all">{settings.dataDir}</p>
                <Button variant="outline" size="sm" onClick={() => void runOk(Atlas.openDataFolder())}>
                  <FolderOpen />
                  打开数据文件夹
                </Button>
              </div>
            </Row>
            <Row title="快捷键">
              <div className="grid w-full grid-cols-2 gap-4 text-xs">
                <KeyList title="主窗口" keys={MAIN_KEYS} />
                <KeyList title="快速记录小窗" keys={CAPTURE_KEYS} />
              </div>
            </Row>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[5.5rem_1fr] items-start gap-3">
      <h3 className="pt-1 text-sm font-medium">{title}</h3>
      <div className="flex min-w-0">{children}</div>
    </section>
  );
}

function KeyList({ title, keys }: { title: string; keys: [string, string][] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-muted-foreground">{title}</div>
      {keys.map(([key, what]) => (
        <div key={key} className="flex items-center gap-2">
          <Kbd>{key}</Kbd>
          <span>{what}</span>
        </div>
      ))}
    </div>
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
    <Row title="快速记录">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">在任何软件里按下它，呼出快速记录小窗。</p>
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
    </Row>
  );
}
