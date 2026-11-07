import { useEffect } from "react";
import { AudioWaveform, CircleOff, Grip, ImageIcon, ImagePlus, Info, RotateCcw, Trash2 } from "lucide-react";
import { Atlas, type Background, type Glass, type Settings, type WallpaperLook } from "@/mygo";
import { run } from "@/lib/api";
import { decorated } from "@/lib/look";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAtlas } from "@/state/atlas";
import { SettingCard } from "./setting-card";

// 设置 → 背景与毛玻璃, and the opacity of the whole window (设置 → 外观).
// A slider shows its change at once, while it is dragged, and saves it once
// let go.

type MotionChoice = "off" | Background;

const MOTIONS: { value: MotionChoice; label: string; icon: typeof Grip }[] = [
  { value: "off", label: "无", icon: CircleOff },
  { value: "grid", label: "点阵网格", icon: Grip },
  { value: "waves", label: "点阵信号", icon: AudioWaveform },
];

/** Turns the moving background off, or on with the one picked. */
async function chooseMotion(choice: MotionChoice): Promise<Settings> {
  if (choice === "off") return Atlas.setEffects(false);
  await Atlas.setBackground(choice);
  return Atlas.setEffects(true);
}

/** Saves a change, and shows the settings Go has; after a failure, the ones it kept. */
function save(call: Promise<Settings>) {
  void run(call).then(async (s) => {
    const settings = s ?? (await run(Atlas.settings()));
    if (settings) useAtlas.setState({ settings });
  });
}

/** Shows a change at once, before Go has saved it. */
function preview(patch: Partial<Settings>) {
  const s = useAtlas.getState().settings;
  if (s) useAtlas.setState({ settings: { ...s, ...patch } });
}

/** While a slider is dragged, the dialog's shade lifts (html[data-tuning]). */
function tuning(on: boolean) {
  document.documentElement.toggleAttribute("data-tuning", on);
}

/** Lifts the shade back once the pointer lets go anywhere, and when the panel goes. */
function useTuningEnds() {
  useEffect(() => {
    const end = () => tuning(false);
    window.addEventListener("pointerup", end);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("blur", end);
      end();
    };
  }, []);
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)_3.5rem] items-center gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onPointerDown={() => tuning(true)}
        onValueChange={([v = value]) => onChange(v)}
        onValueCommit={([v = value]) => {
          tuning(false);
          onCommit(v);
        }}
      />
      <span className="meta-mono text-right text-muted-foreground">
        {value}
        {unit}
      </span>
    </div>
  );
}

function ResetButton({ onClick, label = "恢复默认" }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onClick}>
      <RotateCcw />
      {label}
    </Button>
  );
}

const sameGlass = (a: Glass, b: Glass) => a.blur === b.blur && a.panel === b.panel && a.frame === b.frame;
const sameLook = (a: WallpaperLook, b: WallpaperLook) =>
  a.blur === b.blur && a.opacity === b.opacity && a.scale === b.scale && a.x === b.x && a.y === b.y;

/** 设置 → 背景与毛玻璃. */
export function LookPanel({ settings }: { settings: Settings }) {
  useTuningEnds();
  return (
    <>
      <MotionSetting settings={settings} />
      <WallpaperSetting settings={settings} />
      <GlassSetting settings={settings} />
    </>
  );
}

function MotionSetting({ settings }: { settings: Settings }) {
  return (
    <SettingCard title="动态背景" description="会增加显卡占用。有背景图片时叠在图片上面。">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="self-start"
        value={settings.effects ? settings.background : "off"}
        onValueChange={(v) => {
          if (v) save(chooseMotion(v as MotionChoice));
        }}
      >
        {MOTIONS.map((m) => (
          <ToggleGroupItem key={m.value} value={m.value}>
            <m.icon />
            {m.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </SettingCard>
  );
}

/** Changes how the picture shows; saves it when commit is set. */
function setLook(patch: Partial<WallpaperLook>, commit: boolean) {
  const s = useAtlas.getState().settings;
  if (!s) return;
  const next = { ...s.wallpaper.look, ...patch };
  preview({ wallpaper: { ...s.wallpaper, look: next } });
  if (commit) save(Atlas.setWallpaperLook(next));
}

function WallpaperSetting({ settings }: { settings: Settings }) {
  const w = settings.wallpaper;
  const look = w.look;
  const defaults = settings.lookDefaults.wallpaperLook;

  const row = (key: "blur" | "opacity" | "scale" | "x" | "y") => ({
    value: look[key],
    onChange: (v: number) => setLook({ [key]: v }, false),
    onCommit: (v: number) => setLook({ [key]: v }, true),
  });

  return (
    <SettingCard
      title="背景图片"
      description="设了图片后，就算不开动态背景，框架和内容面板也会变成毛玻璃。"
      action={w.url && !sameLook(look, defaults) && <ResetButton onClick={() => setLook({ ...defaults, enabled: look.enabled }, true)} />}
    >
      <div className="flex items-center gap-3">
        <div className="grid aspect-[16/10] w-32 shrink-0 place-items-center overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10">
          {w.url ? (
            <img src={w.url} alt="背景图片预览" className={look.enabled ? "size-full object-cover" : "size-full object-cover opacity-40 grayscale"} />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="truncate text-xs text-muted-foreground" title={w.name || undefined}>
            {w.url ? w.name || "已设置图片" : "PNG、JPG、WebP、GIF 或 BMP，不超过 20 MB"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => save(Atlas.chooseWallpaper())}>
              <ImagePlus />
              {w.url ? "更换图片" : "选择图片"}
            </Button>
            {w.url && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => save(Atlas.clearWallpaper())}>
                <Trash2 />
                移除
              </Button>
            )}
          </div>
        </div>
        {w.url && (
          <label className="flex shrink-0 items-center gap-2 text-xs">
            <Switch checked={look.enabled} onCheckedChange={(v) => setLook({ enabled: v }, true)} />
            显示
          </label>
        )}
      </div>
      {w.url && (
        <div className={look.enabled ? "flex flex-col gap-3 pt-1" : "pointer-events-none flex flex-col gap-3 pt-1 opacity-50"} aria-disabled={!look.enabled}>
          <SliderRow label="模糊" min={0} max={40} unit="px" {...row("blur")} />
          <SliderRow label="不透明度" min={0} max={100} unit="%" {...row("opacity")} />
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3">
            <span className="text-xs text-muted-foreground">大小</span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              className="self-start"
              value={look.scale === 0 ? "cover" : "custom"}
              onValueChange={(v) => {
                if (v) setLook({ scale: v === "cover" ? 0 : 100 }, true);
              }}
            >
              <ToggleGroupItem value="cover">铺满窗口</ToggleGroupItem>
              <ToggleGroupItem value="custom">自定义缩放</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {look.scale !== 0 && <SliderRow label="缩放" min={20} max={300} step={5} unit="%" {...row("scale")} />}
          <SliderRow label="水平位置" min={0} max={100} unit="%" {...row("x")} />
          <SliderRow label="垂直位置" min={0} max={100} unit="%" {...row("y")} />
        </div>
      )}
    </SettingCard>
  );
}

/** Changes the frosted glass; saves it when commit is set. */
function setGlass(patch: Partial<Glass>, commit: boolean) {
  const s = useAtlas.getState().settings;
  if (!s) return;
  const next = { ...s.glass, ...patch };
  preview({ glass: next });
  if (commit) save(Atlas.setGlass(next));
}

function GlassSetting({ settings }: { settings: Settings }) {
  const g = settings.glass;
  const defaults = settings.lookDefaults.glass;

  const row = (key: keyof Glass) => ({
    value: g[key],
    onChange: (v: number) => setGlass({ [key]: v }, false),
    onCommit: (v: number) => setGlass({ [key]: v }, true),
  });

  return (
    <SettingCard
      title="毛玻璃"
      description="只调框架（顶栏和侧栏）和内容面板，不影响窗口整体透明度。不透明度越低，越能看清背后的背景。"
      action={!sameGlass(g, defaults) && <ResetButton onClick={() => setGlass(defaults, true)} />}
    >
      {!decorated(settings) && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" />
          打开动态背景或显示背景图片后才有毛玻璃。
        </p>
      )}
      <div className="flex flex-col gap-3">
        <SliderRow label="模糊" min={0} max={60} unit="px" {...row("blur")} />
        <SliderRow label="内容面板不透明度" min={0} max={100} unit="%" {...row("panel")} />
        <SliderRow label="框架不透明度" min={0} max={100} unit="%" {...row("frame")} />
      </div>
    </SettingCard>
  );
}

/** 设置 → 外观: the opacity of the whole main window. */
export function WindowOpacitySetting({ settings }: { settings: Settings }) {
  useTuningEnds();
  const { windowOpacity: def, minWindowOpacity: lowest } = settings.lookDefaults;
  return (
    <SettingCard
      title="窗口整体透明度"
      description="整个主窗口连同文字一起变透明，可以透过它看到桌面。和毛玻璃分开调，快速记录小窗不受影响。"
      action={settings.windowOpacity !== def && <ResetButton onClick={() => save(Atlas.setWindowOpacity(def))} />}
    >
      <SliderRow
        label="不透明度"
        min={lowest}
        max={100}
        unit="%"
        value={settings.windowOpacity}
        onChange={(v) => {
          preview({ windowOpacity: v });
          void Atlas.previewWindowOpacity(v);
        }}
        onCommit={(v) => save(Atlas.setWindowOpacity(v))}
      />
    </SettingCard>
  );
}
