import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Copy, Ellipsis, ExternalLink, Link2, Trash2, X } from "lucide-react";
import type { Item, ItemStatus, ItemType } from "@/mygo";
import { errorMessage } from "@/lib/api";
import { useDebouncedSave } from "@/lib/debounce";
import { isComposing } from "@/lib/keys";
import { STATUSES, TYPES, UNSORTED } from "@/lib/labels";
import { formatTime, useNow } from "@/lib/time";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  copyItem,
  moveItemToProject,
  openDeeplink,
  openLink,
  select,
  setItemDeeplink,
  setItemModule,
  setItemNote,
  setItemStatus,
  setItemTitle,
  setItemType,
  useAtlas,
} from "@/state/atlas";
import { IconButton } from "./icon-button";
import { confirmDeleteItem } from "./queue";

/** The panel beside the queue: the selected item, to edit. */
export function ItemDetail() {
  const item = useAtlas((s) => s.items.find((i) => i.id === s.selectedId));
  if (!item) return <DetailEmpty />;
  // A new key per item: the fields and the editor start over with its text.
  return <Detail key={item.id} item={item} />;
}

const KEYS: [string, string][] = [
  ["↑ ↓", "选择上一条、下一条"],
  ["Space", "标为完成，或重新打开"],
  ["S", "开始进行，或退回待办"],
  ["C", "复制给 AI"],
  ["O", "打开链接"],
  ["Enter", "编辑标题"],
  ["Delete", "删除"],
  ["N", "新增一条"],
];

function DetailEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-muted-foreground">
      <p>选中一条改进点，在这里补充备注和链接。</p>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
        {KEYS.map(([key, what]) => (
          <div key={key} className="contents">
            <dt className="justify-self-end">
              <Kbd>{key}</Kbd>
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Detail({ item }: { item: Item }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <ToggleGroup
          type="single"
          size="sm"
          value={item.status}
          onValueChange={(v) => v && void setItemStatus(item.id, v as ItemStatus)}
          aria-label="状态"
        >
          {STATUSES.map((s) => (
            <ToggleGroupItem key={s.value} value={s.value}>
              <s.icon className={s.text} />
              {s.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="复制给 AI" shortcut="C" onClick={() => void copyItem(item.id)}>
            <Copy />
          </IconButton>
          <MoreMenu item={item} />
          <IconButton label="关闭" shortcut="Esc" onClick={() => select(0)}>
            <X />
          </IconButton>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3">
        <TitleField item={item} />
        <div className="flex flex-wrap items-center gap-2">
          <TypeSelect item={item} />
          <ModuleSelect item={item} />
        </div>
        <LinkField item={item} />
        <NoteField item={item} />
      </div>
      <Times item={item} />
    </div>
  );
}

function MoreMenu({ item }: { item: Item }) {
  const projects = useAtlas((s) => s.projects);
  const others = projects.filter((p) => p.id !== item.projectId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="更多">
          <Ellipsis />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={others.length === 0}>
            <ArrowRightLeft />
            移到其他项目
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-48 overflow-y-auto">
            {others.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => void moveItemToProject(item.id, p.id)}>
                <span className="truncate">{p.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => confirmDeleteItem(item)}>
          <Trash2 />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The title, edited in place: Enter saves, Escape gives the edit up. */
function TitleField({ item }: { item: Item }) {
  const [draft, setDraft] = useState(item.title);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(item.title);
  }, [item.title]);

  const save = () => {
    const text = draft.trim();
    if (!text || text === item.title) {
      setDraft(item.title);
      return;
    }
    void setItemTitle(item.id, text).then((saved) => setDraft(saved?.title ?? item.title));
  };

  return (
    <textarea
      data-item-title
      value={draft}
      rows={1}
      maxLength={300}
      aria-label="标题"
      className="field-sizing-content -mx-1.5 resize-none rounded-md bg-transparent px-1.5 py-1 text-base leading-snug font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      onFocus={() => (editing.current = true)}
      onBlur={() => {
        editing.current = false;
        save();
      }}
      onChange={(e) => setDraft(e.target.value.replace(/\s*\n\s*/g, " "))}
      onKeyDown={(e) => {
        if (isComposing(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(item.title);
          editing.current = false;
          // Blur after React applied the reverted text, so nothing saves.
          const el = e.currentTarget;
          requestAnimationFrame(() => el.blur());
        }
      }}
    />
  );
}

function TypeSelect({ item }: { item: Item }) {
  return (
    <Select value={item.type} onValueChange={(v) => void setItemType(item.id, v as ItemType)}>
      <SelectTrigger size="sm" aria-label="类型">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TYPES.map((t) => (
          <SelectItem key={t.value} value={t.value}>
            <t.icon className={t.text} />
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ModuleSelect({ item }: { item: Item }) {
  const modules = useAtlas((s) => s.modules);
  return (
    <Select value={String(item.moduleId)} onValueChange={(v) => void setItemModule(item.id, Number(v))}>
      <SelectTrigger size="sm" aria-label="模块" className="max-w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="0">{UNSORTED}</SelectItem>
        {modules.map((m) => (
          <SelectItem key={m.id} value={String(m.id)}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The link the item is bound to. It saves on Enter or when the field loses
 * the keyboard; a link the app refuses stays in the field, with why.
 */
function LinkField({ item }: { item: Item }) {
  const [draft, setDraft] = useState(item.deeplink);
  const [error, setError] = useState("");
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(item.deeplink);
  }, [item.deeplink]);

  const save = async (value: string) => {
    if (value.trim() === item.deeplink) {
      setDraft(item.deeplink);
      setError("");
      return;
    }
    try {
      const saved = await setItemDeeplink(item.id, value);
      setDraft(saved.deeplink);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <InputGroup className="h-8">
        <InputGroupAddon>
          <Link2 />
        </InputGroupAddon>
        <InputGroupInput
          value={draft}
          placeholder="可选：绑定一个链接，比如 AI 对话、文档或本地文件"
          aria-label="链接"
          aria-invalid={!!error}
          spellCheck={false}
          onFocus={() => (editing.current = true)}
          onBlur={() => {
            editing.current = false;
            void save(draft);
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (isComposing(e)) return;
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(item.deeplink);
              setError("");
              editing.current = false;
              const el = e.currentTarget;
              requestAnimationFrame(() => el.blur());
            }
          }}
        />
        {item.deeplink && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="打开链接" title="打开链接（O）" onClick={() => openDeeplink(item.id)}>
              <ExternalLink />
            </InputGroupButton>
            <InputGroupButton
              size="icon-xs"
              aria-label="解除链接"
              title="解除链接"
              onClick={() => {
                setDraft("");
                void save("");
              }}
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      {error && <p className="px-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** The notes, in the live preview editor; they save as the user pauses. */
function NoteField({ item }: { item: Item }) {
  const { schedule, flush } = useDebouncedSave((note) => {
    // The item may be gone meanwhile, deleted or moved to another project.
    if (useAtlas.getState().items.some((i) => i.id === item.id)) void setItemNote(item.id, note);
  });

  return (
    <div className="-mx-1 flex min-h-40 flex-1 flex-col border-t pt-2">
      <MarkdownEditor
        value={item.note}
        className="flex-1 px-1"
        placeholder="备注：用 Markdown 写，边写边预览"
        onChange={schedule}
        onBlur={flush}
        onOpenLink={openLink}
      />
    </div>
  );
}

function Times({ item }: { item: Item }) {
  const now = useNow();
  const parts = [`创建于 ${formatTime(item.createdAt, now)}`];
  if (item.startedAt) parts.push(`开始于 ${formatTime(item.startedAt, now)}`);
  if (item.doneAt) parts.push(`完成于 ${formatTime(item.doneAt, now)}`);
  return <p className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">{parts.join(" · ")}</p>;
}
