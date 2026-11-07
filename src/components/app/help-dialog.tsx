import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AppWindow,
  ChevronRight,
  Copy,
  FileText,
  FolderOpen,
  Globe,
  Keyboard,
  LayoutDashboard,
  Lightbulb,
  Link2,
  ListTodo,
  MousePointerClick,
  NotebookPen,
  PanelRight,
  PenLine,
  Repeat,
  Rocket,
  Settings,
  SquareCheck,
  TextCursorInput,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { acceleratorKeys } from "@/lib/keys";
import { STATUSES, TYPES } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useAtlas } from "@/state/atlas";
import { closeHelp, showSettingsTab, useDialogs } from "@/state/dialogs";
import { TypeChip } from "./item-marks";
import { NAV_ITEM, NavColumn, NavIndicator, NavLabel } from "./side-nav";

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "start", label: "开始使用", icon: Rocket },
  { id: "capture", label: "快速记录", icon: Zap },
  { id: "queue", label: "队列与状态", icon: ListTodo },
  { id: "detail", label: "改进点详情", icon: PanelRight },
  { id: "markdown", label: "Markdown 备注", icon: FileText },
  { id: "overview", label: "项目总览", icon: LayoutDashboard },
  { id: "keys", label: "快捷键", icon: Keyboard },
];

/** 使用说明: a guide on the right, and on the left where you are in it. */
export function HelpDialog() {
  const open = useDialogs((s) => s.help);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeHelp()}>
      <DialogContent className="flex h-[min(40rem,88vh)] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <HelpBody />
      </DialogContent>
    </Dialog>
  );
}

/** The room left over a section scrolled to. */
const SCROLL_MARGIN = 20;

function sectionIn(box: HTMLElement, id: string): HTMLElement | null {
  return box.querySelector<HTMLElement>(`[data-help="${id}"]`);
}

/** The dialog's content; it mounts each time the dialog opens. */
function HelpBody() {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(SECTIONS[0]!.id);
  // While a click scrolls to a section, the scrolling does not move the highlight.
  const jumping = useRef(0);

  const jump = (id: string) => {
    const box = scroller.current;
    const el = box && sectionIn(box, id);
    if (!box || !el) return;
    setActive(id);
    window.clearTimeout(jumping.current);
    jumping.current = window.setTimeout(() => (jumping.current = 0), 700);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top: el.offsetTop - SCROLL_MARGIN, behavior: reduce ? "auto" : "smooth" });
  };

  // The section the dialog opens at; the scroll then moves the highlight to it.
  useEffect(() => {
    const box = scroller.current;
    const at = useDialogs.getState().helpAt;
    const el = box && at ? sectionIn(box, at) : null;
    if (box && el) box.scrollTop = el.offsetTop - SCROLL_MARGIN;
  }, [scroller]);
  useEffect(() => () => window.clearTimeout(jumping.current), []);

  const onScroll = () => {
    const box = scroller.current;
    if (!box || jumping.current) return;
    let at = SECTIONS[0]!.id;
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4) {
      at = SECTIONS[SECTIONS.length - 1]!.id;
    } else {
      for (const s of SECTIONS) {
        const el = sectionIn(box, s.id);
        if (el && el.offsetTop - box.scrollTop <= 64) at = s.id;
      }
    }
    setActive(at);
  };

  return (
    <>
      <NavColumn>
        <DialogHeader className="px-2.5 pt-1">
          <DialogTitle>使用说明</DialogTitle>
          <DialogDescription className="sr-only">Vibe Atlas 的用法和全部快捷键</DialogDescription>
        </DialogHeader>
        <nav aria-label="导览" className="flex flex-col gap-1.5">
          <NavLabel>导览</NavLabel>
          <div className="relative flex flex-col gap-0.5">
            <NavIndicator index={SECTIONS.findIndex((s) => s.id === active)} />
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={NAV_ITEM}
                data-active={s.id === active}
                aria-current={s.id === active ? "location" : undefined}
                onClick={() => jump(s.id)}
              >
                <s.icon />
                {s.label}
              </button>
            ))}
          </div>
        </nav>
        <button type="button" className={cn(NAV_ITEM, "mt-auto")} onClick={() => showSettingsTab("capture")}>
          <Settings />
          <span className="flex-1">设置</span>
          <span className="meta-mono opacity-70">Ctrl+,</span>
        </button>
      </NavColumn>
      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
        <article className="selectable flex flex-col gap-10 px-8 pt-7 pb-10">
          <StartSection />
          <CaptureSection />
          <QueueSection />
          <DetailSection />
          <MarkdownSection />
          <OverviewSection />
          <KeysSection />
        </article>
      </div>
    </>
  );
}

// ---- The sections ----

function StartSection() {
  return (
    <Section id="start" lead="按「项目 → 模块 → 改进点」整理你的 vibe 项目。状态全部由你手动切换，软件不联网，也不内置 AI。">
      <div className="flex flex-wrap items-center gap-2">
        <Node title="项目" hint="比如「规则恐怖」" />
        <ChevronRight className="size-4 text-muted-foreground" />
        <Node title="模块" hint="武器系统、关卡……可以不挂" />
        <ChevronRight className="size-4 text-muted-foreground" />
        <Node title="改进点" hint="一件具体要做的事" />
      </div>
      <ol className="grid grid-cols-2 gap-2.5">
        <Step n={1} title="记下">
          看到运行结果时按 <Accel /> 呼出小窗，连记几条改进、bug、新需求。
        </Step>
        <Step n={2} title="挑一条">
          在待办里拖动排序，选中一条按 <K>C</K> 复制，自己粘贴给 AI。
        </Step>
        <Step n={3} title="标进度">
          开始做时按 <K>S</K> 标为进行中，做完按 <K>Space</K> 打勾。
        </Step>
        <Step n={4} title="看全貌">
          积累下来的记录，在项目总览里汇总成模块进度和完成历史。
        </Step>
      </ol>
    </Section>
  );
}

function CaptureSection() {
  return (
    <Section id="capture" lead="在任何软件里按下全局快捷键，屏幕上方弹出小窗，记完一条就能回去干活。">
      <div className="flex items-center gap-3 rounded-lg bg-card p-3.5 ring-1 ring-foreground/[0.07]">
        <span className="text-muted-foreground">当前快捷键</span>
        <Accel />
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => showSettingsTab("capture")}>
          <Settings />
          在设置里修改
        </Button>
      </div>
      <Points>
        <li>默认记到主窗口当前打开的项目；没有打开时，用上次记录用的项目。</li>
        <li>
          输入标题按 <K>Enter</K> 保存，可以接着记下一条；记过的会在小窗里列出「已记到 某项目」。
        </li>
        <li>点到别处，小窗自动隐藏。</li>
      </Points>
      <Tip>主窗口队列底部也有一样的输入框。在某个模块或类型的筛选下新增，会自动用这个模块和类型。</Tip>
    </Section>
  );
}

const STATUS_HINTS: Record<string, string> = {
  todo: "打算做的，拖动排序表示先后",
  doing: "正在做的，不限数量",
  done: "做完的，默认折叠，最近的在上面",
};

function QueueSection() {
  return (
    <Section id="queue" lead="每个项目一条队列，三种类型混放，按状态分成三块。">
      <div className="grid grid-cols-3 gap-2.5">
        {STATUSES.map((s) => (
          <div key={s.value} className="flex flex-col gap-1.5 rounded-lg bg-card p-3 ring-1 ring-foreground/[0.07]">
            <span className={cn("flex items-center gap-1.5 font-medium", s.text)}>
              <s.icon className="size-4" />
              {s.label}
            </span>
            <span className="text-xs text-muted-foreground">{STATUS_HINTS[s.value]}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {TYPES.map((t) => (
          <TypeChip key={t.value} type={t.value} />
        ))}
        <span className="ml-1 text-muted-foreground">
          三种类型，新增时按 <K>Tab</K> 切换
        </span>
      </div>
      <Points>
        <li>点行首的圆圈标为完成或重新打开。状态可以在三种之间随意切换，切换时自动记下开始和完成时间。</li>
        <li>队列顶部按状态和类型筛选，侧栏点模块按模块筛选；可以组合，一键清除。</li>
        <li>右键一条：改状态、复制、打开链接、移到模块或其他项目、删除。</li>
      </Points>
    </Section>
  );
}

function DetailSection() {
  return (
    <Section id="detail" lead="选中一条，右边显示它的详情。所有改动立即保存，没有保存按钮。">
      <div className="flex flex-col gap-2.5">
        <Feature icon={Repeat} title="状态">
          类型前面的状态按钮，点一下按「待办 → 进行中 → 完成 → 待办」轮换。标题同一行右边是复制给 AI、移到其他项目、删除和关闭。
        </Feature>
        <Feature icon={Link2} title="deeplink">
          绑定 AI 对话、<Code>vscode://</Code> 链接、网页或本地文件。粘贴本地路径会自动转成 <Code>file:</Code> 链接；点行内图标或按{" "}
          <K>O</K> 打开。
        </Feature>
        <Feature icon={Copy} title="复制给 AI">
          按 <K>C</K> 把标题和备注复制成一段 Markdown，自己粘贴发送。
        </Feature>
        <Feature icon={NotebookPen} title="备注">
          用 Markdown 写，停顿 0.5 秒或离开编辑器时自动保存。
        </Feature>
      </div>
    </Section>
  );
}

function MarkdownSection() {
  return (
    <Section id="markdown" lead="备注和项目说明用同一个编辑器：光标所在的行显示源码，其他行直接显示渲染效果。">
      <div className="grid grid-cols-2 overflow-hidden rounded-lg ring-1 ring-foreground/[0.07]">
        <div className="flex flex-col gap-2 bg-muted/60 p-3.5">
          <span className="text-xs text-muted-foreground">你输入的</span>
          <pre className="font-mono text-xs leading-6 whitespace-pre-wrap">
            {"## 手感\n- [x] 射速调慢\n- [ ] **先改**后坐力\n> 参考 `weapon.ts`"}
          </pre>
        </div>
        <div className="flex flex-col gap-2 bg-card p-3.5">
          <span className="text-xs text-muted-foreground">看到的</span>
          <div className="flex flex-col gap-1 leading-6">
            <span className="text-base font-semibold">手感</span>
            <span className="flex items-center gap-1.5 text-muted-foreground line-through">
              <SquareCheck className="size-3.5 text-done" />
              射速调慢
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3.5 rounded-[3px] ring-1 ring-muted-foreground/60" />
              <span>
                <strong>先改</strong>后坐力
              </span>
            </span>
            <span className="border-l-2 pl-2 text-muted-foreground">
              参考 <Code>weapon.ts</Code>
            </span>
          </div>
        </div>
      </div>
      <Points>
        <li>支持标题、粗体、斜体、删除线、行内代码、链接、引用、代码块（带语法高亮）、列表、任务框和分隔线。</li>
        <li>任务框可以直接点击勾选；列表里回车自动续写下一项。</li>
        <li>
          点链接直接打开；光标正在编辑的那一行，用 <K>Ctrl</K>+点击打开。
        </li>
      </Points>
    </Section>
  );
}

function OverviewSection() {
  return (
    <Section id="overview" lead="在队列顶部切到「总览」，看这个项目的全貌。">
      <Points>
        <li>项目说明（Markdown），以及全部、待办、进行中、完成的数量和总进度。</li>
        <li>模块进度和类型分布，点一项跳到按它筛选的队列。</li>
        <li>进行中列表和按天分组的完成记录，点一条跳到队列里的那一条。</li>
      </Points>
      <Feature icon={FolderOpen} title="绑定文件夹">
        项目栏的文件夹按钮可以绑定一个本地文件夹，之后一键在资源管理器打开。
      </Feature>
    </Section>
  );
}

type KeyRow = [what: string, combos: string[]];

const KEY_GROUPS: { icon: LucideIcon; title: string; hint?: string; rows: KeyRow[] }[] = [
  {
    icon: AppWindow,
    title: "主窗口",
    rows: [
      ["新增一条", ["N"]],
      ["选择上一条、下一条", ["↑ ↓", "K J"]],
      ["取消选择", ["Esc"]],
      ["打开设置", ["Ctrl+,"]],
      ["打开使用说明", ["F1"]],
    ],
  },
  {
    icon: MousePointerClick,
    title: "选中的改进点",
    rows: [
      ["标为完成，或重新打开", ["Space"]],
      ["开始进行，或退回待办", ["S"]],
      ["复制给 AI", ["C", "Ctrl+C"]],
      ["打开链接", ["O"]],
      ["编辑标题", ["Enter", "E"]],
      ["删除", ["Delete"]],
    ],
  },
  {
    icon: TextCursorInput,
    title: "队列底部的输入框",
    rows: [
      ["新增到待办最后", ["Enter"]],
      ["切换类型", ["Tab", "Shift+Tab"]],
    ],
  },
  {
    icon: Zap,
    title: "快速记录小窗",
    rows: [
      ["保存，接着记下一条", ["Enter"]],
      ["切换类型", ["Tab", "Shift+Tab"]],
      ["切换项目", ["↑ ↓"]],
      ["切换模块", ["Ctrl+↑ ↓"]],
      ["关闭小窗", ["Esc"]],
    ],
  },
  {
    icon: PenLine,
    title: "Markdown 编辑器",
    rows: [
      ["粗体", ["Ctrl+B"]],
      ["斜体", ["Ctrl+I"]],
      ["行内代码", ["Ctrl+E"]],
      ["删除线", ["Ctrl+Shift+X"]],
      ["插入链接", ["Ctrl+K"]],
      ["缩进、取消缩进", ["Tab", "Shift+Tab"]],
      ["撤销", ["Ctrl+Z"]],
      ["重做", ["Ctrl+Y", "Ctrl+Shift+Z"]],
    ],
  },
];

function KeysSection() {
  return (
    <Section id="keys" lead="只有呼出快速记录的全局快捷键可以在设置里改，其他按键都是固定的。">
      <KeyCard icon={Globe} title="全局" hint="在任何软件里">
        <KeyLine what="呼出快速记录小窗">
          <Accel />
        </KeyLine>
      </KeyCard>
      {KEY_GROUPS.map((g) => (
        <KeyCard key={g.title} icon={g.icon} title={g.title} hint={g.hint}>
          {g.rows.map(([what, combos]) => (
            <KeyLine key={what} what={what}>
              {combos.map((c, i) => (
                <span key={c} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-xs text-muted-foreground/70">/</span>}
                  <Combo combo={c} />
                </span>
              ))}
            </KeyLine>
          ))}
        </KeyCard>
      ))}
      <Tip>单个字母、Space、Enter 这些键只在没有输入框获得焦点时生效，不会打断打字；输入法正在选词时也不会触发。</Tip>
    </Section>
  );
}

// ---- The pieces ----

function Section({ id, lead, children }: { id: string; lead: string; children: ReactNode }) {
  const s = SECTIONS.find((x) => x.id === id)!;
  return (
    <section data-help={id} aria-labelledby={`help-${id}`} className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h2 id={`help-${id}`} className="flex items-center gap-2.5 text-lg leading-tight font-semibold">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted ring-1 ring-foreground/[0.06]">
            <s.icon className="size-4" />
          </span>
          {s.label}
        </h2>
        <p className="leading-relaxed text-muted-foreground">{lead}</p>
      </header>
      {children}
    </section>
  );
}

function Node({ title, hint }: { title: string; hint: string }) {
  return (
    <span className="flex flex-col rounded-lg bg-card px-3 py-2 ring-1 ring-foreground/[0.07]">
      <span className="font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </span>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-lg bg-card p-3.5 ring-1 ring-foreground/[0.07]">
      <span className="flex items-center gap-2 font-medium">
        <span className="meta-mono grid size-5 place-items-center rounded-full bg-foreground text-background">{n}</span>
        {title}
      </span>
      <span className="text-xs leading-relaxed text-muted-foreground">{children}</span>
    </li>
  );
}

function Points({ children }: { children: ReactNode }) {
  return (
    <ul className="flex flex-col gap-2 leading-relaxed [&>li]:relative [&>li]:pl-4 [&>li]:before:absolute [&>li]:before:top-[0.6em] [&>li]:before:left-0.5 [&>li]:before:size-1.5 [&>li]:before:rounded-full [&>li]:before:bg-muted-foreground/50">
      {children}
    </ul>
  );
}

function Feature({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg bg-card p-3.5 ring-1 ring-foreground/[0.07]">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{title}</span>
        <span className="leading-relaxed text-muted-foreground">{children}</span>
      </div>
    </div>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2.5 rounded-lg bg-muted/70 p-3 text-xs leading-relaxed text-muted-foreground">
      <Lightbulb className="mt-px size-3.5 shrink-0 text-feature" />
      <span>{children}</span>
    </p>
  );
}

function KeyCard({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg bg-card ring-1 ring-foreground/[0.07]">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3.5 py-2 font-medium">
        <Icon className="size-4 text-muted-foreground" />
        {title}
        {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </div>
      <div className="divide-y">{children}</div>
    </div>
  );
}

function KeyLine({ what, children }: { what: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center gap-3 px-3.5 py-1.5">
      <span className="min-w-0 flex-1">{what}</span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{children}</span>
    </div>
  );
}

/** A key, written in the text. */
function K({ children }: { children: ReactNode }) {
  return <Kbd className="mx-0.5 align-[1px] text-foreground ring-1 ring-foreground/10">{children}</Kbd>;
}

/** Keys pressed together, as "Ctrl+Shift+X"; "↑ ↓" is either of two keys. */
function Combo({ combo }: { combo: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {combo.split(/[+ ]/).map((k, i) => (
        <Kbd key={i} className="h-6 min-w-6 px-1.5 text-foreground ring-1 ring-foreground/10">
          {k}
        </Kbd>
      ))}
    </span>
  );
}

/** The global shortcut of quick capture, as set now. */
function Accel() {
  const shortcut = useAtlas((s) => s.settings?.shortcut);
  if (!shortcut) return null;
  return (
    <span className="inline-flex items-center gap-1 align-[1px]">
      {acceleratorKeys(shortcut).map((k, i) => (
        <Kbd key={i} className="text-foreground ring-1 ring-foreground/10">
          {k}
        </Kbd>
      ))}
    </span>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-px font-mono text-[0.85em] text-foreground">{children}</code>;
}
