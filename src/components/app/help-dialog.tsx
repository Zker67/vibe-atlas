import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AppWindow,
  ChevronRight,
  Combine,
  Copy,
  CornerDownRight,
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
import { Scroller } from "@/components/ui/scroller";
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
          <DialogDescription className="sr-only">Vibe Atlas 的用法和快捷键</DialogDescription>
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
      <Scroller ref={scroller} onScroll={onScroll} always className="min-w-0 flex-1" viewportClassName="relative">
        <article className="selectable flex flex-col gap-10 px-8 pt-7 pb-10">
          <StartSection />
          <CaptureSection />
          <QueueSection />
          <DetailSection />
          <MarkdownSection />
          <OverviewSection />
          <KeysSection />
        </article>
      </Scroller>
    </>
  );
}

// ---- The sections ----

function StartSection() {
  return (
    <Section id="start" lead="Vibe Atlas 用项目、模块、改进点三层来整理工作。">
      <div className="flex flex-wrap items-center gap-2">
        <Node title="项目" hint="一个完整的项目" />
        <ChevronRight className="size-4 text-muted-foreground" />
        <Node title="模块" hint="项目的一部分，可选" />
        <ChevronRight className="size-4 text-muted-foreground" />
        <Node title="改进点" hint="一件要做的事" />
      </div>
      <ol className="grid grid-cols-2 gap-2.5">
        <Step n={1} title="记录改进点">
          按 <Accel /> 打开快速记录，输入标题后按 <K>Enter</K>。
        </Step>
        <Step n={2} title="安排顺序">
          在待办中拖动排序，排在上面的先做；拖到另一条上可以合并。
        </Step>
        <Step n={3} title="交给 AI">
          选中一条按 <K>C</K> 复制，粘贴到 AI 对话中。
        </Step>
        <Step n={4} title="标记进度">
          开始时按 <K>S</K>，完成后按 <K>Space</K>。
        </Step>
      </ol>
    </Section>
  );
}

function CaptureSection() {
  return (
    <Section id="capture" lead="在任何软件中按快捷键，都能打开快速记录窗口。">
      <div className="flex items-center gap-3 rounded-lg bg-card p-3.5 ring-1 ring-foreground/[0.07]">
        <span className="text-muted-foreground">快捷键</span>
        <Accel />
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => showSettingsTab("capture")}>
          <Settings />
          修改
        </Button>
      </div>
      <Points>
        <li>改进点会记录到主窗口当前打开的项目；点底栏的项目和模块，可以搜索、切换或直接新建。</li>
        <li>
          按 <K>Enter</K> 保存后，可以继续输入下一条。
        </li>
        <li>
          按 <K>Shift+Enter</K> 展开详情，写 Markdown 备注、贴 deeplink，和标题一起保存。
        </li>
        <li>点击窗口外部即可关闭，没保存的内容下次还在。</li>
      </Points>
    </Section>
  );
}

const STATUS_HINTS: Record<string, string> = {
  todo: "等待处理，可以拖动排序",
  doing: "正在处理",
  done: "已完成，默认收起",
};

function QueueSection() {
  return (
    <Section id="queue" lead="每个项目有一个队列，改进点按状态分组显示。">
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
          新增时按 <K>Tab</K> 切换类型
        </span>
      </div>
      <Points>
        <li>点击行首的圆圈，标记完成或重新打开。</li>
        <li>单击改进点打开详情，双击直接在行内改名（Enter 保存，Esc 放弃）。</li>
        <li>在队列顶部按状态和类型筛选，在侧栏按模块筛选。</li>
        <li>右键单击改进点，可以修改状态、添加子改进点、移动或删除。</li>
        <li>点击分区标题，收起或展开进行中、待办、已完成。</li>
        <li>把改进点拖到另一个分区的标题或空白处，就改成那个状态；分区收起时也可以拖到标题上。</li>
      </Points>
      <DropGuide />
      <Points>
        <li>子改进点可以一层层往下套，层数不限，每一条都有自己的状态。</li>
        <li>
          点击行首的箭头，或按 <K>←</K> <K>→</K>，收起和展开子改进点。
        </li>
        <li>删除父改进点时，子改进点会上移一层，不会被一起删除。</li>
      </Points>
    </Section>
  );
}

/** Where a row dragged onto another lands, drawn as three rows. */
function DropGuide() {
  const row = "relative flex h-9 items-center gap-2 rounded-md px-2.5";
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-card p-3.5 ring-1 ring-foreground/[0.07]">
      <span className="font-medium">拖到另一条改进点上</span>
      <div className="flex flex-col gap-1.5">
        <div className={cn(row, "bg-muted/60")}>
          <span className="absolute -top-px right-2 left-2 h-0.5 rounded-full bg-primary" />
          <span className="min-w-0 flex-1 truncate">拖到上沿或下沿</span>
          <span className="text-xs text-muted-foreground">移到它前面或后面</span>
        </div>
        <div className={cn(row, "bg-primary/10 shadow-[inset_0_0_0_1.5px_var(--primary)]")}>
          <span className="min-w-0 flex-1 truncate">拖到中间</span>
          <span className="flex h-5 items-center gap-1 rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground">
            <Combine className="size-3" />
            合并
          </span>
        </div>
        <div className={cn(row, "bg-primary/10 shadow-[inset_0_0_0_1.5px_var(--primary)]")}>
          <span className="min-w-0 flex-1 truncate">拖到已有子改进点的那一条中间</span>
          <span className="flex h-5 items-center gap-1 rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground">
            <CornerDownRight className="size-3" />
            放入
          </span>
        </div>
      </div>
      <span className="leading-relaxed text-muted-foreground">
        合并后会多出一个父改进点，两条都放到它下面。父改进点的名字是第一条标题的前六个字加上「等 N 个改进点」，比如「修复登录按钮等 2
        个改进点」；子改进点有增减时数量会跟着变，自己改过名字后就不再自动改。
      </span>
    </div>
  );
}

function DetailSection() {
  return (
    <Section id="detail" lead="选中改进点后，右侧显示详情，修改会自动保存。">
      <div className="flex flex-col gap-2.5">
        <Feature icon={Repeat} title="状态">
          直接点选待办、进行中或完成；下方的时间线记下创建、开始、完成的时间和各段用时。
        </Feature>
        <Feature icon={Link2} title="链接">
          可以关联 AI 对话、网页或本地文件，按 <K>O</K> 打开。
        </Feature>
        <Feature icon={Copy} title="复制给 AI">
          按 <K>C</K> 复制标题和备注，有子改进点时附上它们的清单，粘贴给 AI 即可。
        </Feature>
        <Feature icon={NotebookPen} title="备注">
          支持 Markdown 格式。
        </Feature>
      </div>
    </Section>
  );
}

function MarkdownSection() {
  return (
    <Section id="markdown" lead="备注和项目说明支持 Markdown，输入时直接显示效果。">
      <div className="grid grid-cols-2 overflow-hidden rounded-lg ring-1 ring-foreground/[0.07]">
        <div className="flex flex-col gap-2 bg-muted/60 p-3.5">
          <span className="text-xs text-muted-foreground">输入</span>
          <pre className="font-mono text-xs leading-6 whitespace-pre-wrap">
            {"## 登录页\n- [x] 调整按钮颜色\n- [ ] **修复**输入框错位\n> 参考 `login.tsx`"}
          </pre>
        </div>
        <div className="flex flex-col gap-2 bg-card p-3.5">
          <span className="text-xs text-muted-foreground">显示</span>
          <div className="flex flex-col gap-1 leading-6">
            <span className="text-base font-semibold">登录页</span>
            <span className="flex items-center gap-1.5 text-muted-foreground line-through">
              <SquareCheck className="size-3.5 text-done" />
              调整按钮颜色
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3.5 rounded-[3px] ring-1 ring-muted-foreground/60" />
              <span>
                <strong>修复</strong>输入框错位
              </span>
            </span>
            <span className="border-l-2 pl-2 text-muted-foreground">
              参考 <Code>login.tsx</Code>
            </span>
          </div>
        </div>
      </div>
      <Points>
        <li>支持标题、列表、任务框、链接、引用、代码块等常用格式。</li>
        <li>点击任务框可以直接勾选。</li>
      </Points>
    </Section>
  );
}

function OverviewSection() {
  return (
    <Section id="overview" lead="在队列顶部切换到「总览」，查看项目进度。">
      <Points>
        <li>编写项目说明。</li>
        <li>查看各模块的进度和类型分布，点击可以跳到对应的队列。</li>
        <li>查看进行中的改进点和每天的完成记录。</li>
      </Points>
      <Feature icon={FolderOpen} title="绑定文件夹">
        为项目绑定本地文件夹后，可以一键打开。
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
      ["新增改进点", ["N"]],
      ["上一条 / 下一条", ["↑ ↓", "K J"]],
      ["取消选择", ["Esc"]],
      ["设置", ["Ctrl+,"]],
      ["使用说明", ["F1"]],
    ],
  },
  {
    icon: MousePointerClick,
    title: "选中的改进点",
    rows: [
      ["完成 / 重新打开", ["Space"]],
      ["开始 / 退回待办", ["S"]],
      ["复制给 AI", ["C", "Ctrl+C"]],
      ["打开链接", ["O"]],
      ["编辑标题", ["Enter", "E"]],
      ["收起子改进点 / 回到上级", ["←"]],
      ["展开子改进点 / 进入第一条", ["→"]],
      ["删除", ["Delete"]],
    ],
  },
  {
    icon: TextCursorInput,
    title: "队列输入框",
    rows: [
      ["新增", ["Enter"]],
      ["切换类型", ["Tab", "Shift+Tab"]],
    ],
  },
  {
    icon: Zap,
    title: "快速记录窗口",
    rows: [
      ["保存", ["Enter"]],
      ["展开详情（备注和链接）", ["Shift+Enter"]],
      ["在详情里保存", ["Ctrl+Enter"]],
      ["切换类型", ["Tab", "Shift+Tab"]],
      ["搜索或新建项目", ["Ctrl+P"]],
      ["搜索或新建模块", ["Ctrl+M"]],
      ["轮换项目", ["↑ ↓"]],
      ["轮换模块", ["Ctrl+↑ ↓"]],
      ["返回标题 / 关闭", ["Esc"]],
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
      ["缩进 / 取消缩进", ["Tab", "Shift+Tab"]],
      ["撤销", ["Ctrl+Z"]],
      ["重做", ["Ctrl+Y", "Ctrl+Shift+Z"]],
    ],
  },
];

function KeysSection() {
  return (
    <Section id="keys" lead="快速记录的快捷键可以在设置中修改。">
      <KeyCard icon={Globe} title="全局" hint="在任何软件中">
        <KeyLine what="打开快速记录">
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
      <Tip>输入文字时，单键快捷键不会生效。</Tip>
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
