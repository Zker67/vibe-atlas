// Files in notes (attachments.go): links to files kept in the app,
// [name](<attachment:<folder>/<name>>), or left where they are,
// [name](<file:///…>). A line of nothing but such links shows as cards, one
// a line, as a line of pictures does; while the cursor is on it, its
// Markdown shows with the cards under it. Links among other text stay
// links. Files pasted or dropped come here from images.ts.

import { type EditorState, type Range, StateField, type Text, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { isMyGo, onFileDrop } from "mygo-runtime";
import { Copy, ExternalLink, FolderOpen, HardDrive, Link2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, run } from "@/lib/api";
import { formatBytes } from "@/lib/bytes";
import { type MenuEntries, showPageMenu } from "@/lib/page-menu";
import { Atlas, type Attached, type FileInfo } from "@/mygo";
import { focused, inCode, placeBlock } from "./images";

/** A link to a file, the URL in angle brackets or not in group 2. */
const linkPattern = /\[((?:\\.|[^\]\\\n])*)\]\((<(?:attachment|file):[^<>\n]+>|(?:attachment|file):[^()\s]+)\)/g;

export interface FileRef {
  from: number;
  to: number;
  /** The text of the link, unescaped. */
  name: string;
  /** The URL, without angle brackets. */
  link: string;
}

function unescape(text: string): string {
  return text.replace(/\\(.)/g, "$1");
}

/** The name as the text of a Markdown link. */
export function linkText(name: string): string {
  return name.replace(/[[\]\\]/g, "\\$&");
}

/** The Markdown of a link to a file. */
export function fileMarkdown(name: string, link: string): string {
  return `[${linkText(name)}](<${link}>)`;
}

/** The links to files on a line, when it has nothing else, outside code; none otherwise. */
export function fileLine(state: EditorState, from: number, text: string): FileRef[] {
  if (!text.includes("attachment:") && !text.includes("file:")) return [];
  const out: FileRef[] = [];
  let rest = "";
  let pos = 0;
  for (const m of text.matchAll(linkPattern)) {
    // ![…](…) is a picture.
    if (m.index > 0 && text[m.index - 1] === "!") return [];
    rest += text.slice(pos, m.index);
    pos = m.index + m[0].length;
    const at = from + m.index;
    if (inCode(state, at)) return [];
    const url = m[2]!;
    out.push({ from: at, to: at + m[0].length, name: unescape(m[1]!), link: url.startsWith("<") ? url.slice(1, -1) : url });
  }
  rest += text.slice(pos);
  return rest.trim() === "" ? out : [];
}

// ---- What the cards show ----

const missingInfo = (link: string): FileInfo => ({
  link,
  name: "",
  path: "",
  folder: "",
  exists: false,
  dir: false,
  size: 0,
  stored: link.startsWith("attachment:"),
  canUnstore: false,
  canStore: false,
});

/** Infos asked for lately, so that cards drawn again do not ask again. */
const infos = new Map<string, { at: number; info: Promise<FileInfo> }>();
let batch: { link: string; resolve: (info: FileInfo) => void }[] = [];

function flush() {
  const asked = batch;
  batch = [];
  Atlas.fileInfo(asked.map((a) => a.link)).then(
    (list) => asked.forEach((a, i) => a.resolve(list[i] ?? missingInfo(a.link))),
    () => asked.forEach((a) => a.resolve(missingInfo(a.link))),
  );
}

/** What the card of link shows, asked of Go with the other cards drawn at the same time. */
function infoOf(link: string): Promise<FileInfo> {
  const hit = infos.get(link);
  if (hit && Date.now() - hit.at < 4000) return hit.info;
  const info = new Promise<FileInfo>((resolve) => {
    if (batch.length === 0) queueMicrotask(flush);
    batch.push({ link, resolve });
  });
  infos.set(link, { at: Date.now(), info });
  return info;
}

/** Files may have moved while the window was away. */
if (typeof window !== "undefined") window.addEventListener("focus", () => infos.clear());

const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const sheet =
  '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/>';
const ICONS = {
  file: svg(sheet),
  folder: svg(
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  ),
  text: svg(sheet + '<path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'),
  archive: svg(
    '<path d="M13.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v11.5"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M8 12v-1"/><path d="M8 18v-2"/><path d="M8 7V6"/><circle cx="8" cy="20" r="2"/>',
  ),
  code: svg(sheet + '<path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/>'),
  sheet: svg(sheet + '<path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>'),
  image: svg(sheet + '<circle cx="10" cy="12" r="2"/><path d="m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22"/>'),
  audio: svg(
    '<path d="M11.65 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v10.35"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M8 20v-7l3 1.474"/><circle cx="6" cy="20" r="2"/>',
  ),
  video: svg(
    sheet +
      '<path d="M15.033 13.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56v-4.704a.645.645 0 0 1 .967-.56z"/>',
  ),
};
const storedIcon = svg(
  '<path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/>',
);
const linkedIcon = svg(
  '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
);
const xIcon = svg('<path d="M18 6 6 18M6 6l12 12"/>');

const KINDS: [RegExp, keyof typeof ICONS][] = [
  [/\.(pdf|docx?|odt|rtf|txt|md|markdown|pages|epub|pptx?|key)$/i, "text"],
  [/\.(zip|rar|7z|tar|gz|tgz|bz2|xz|iso|dmg)$/i, "archive"],
  [/\.(xlsx?|csv|tsv|ods|numbers)$/i, "sheet"],
  [/\.(png|jpe?g|gif|webp|bmp|svg|psd|ai|fig|sketch|tiff?|heic|ico)$/i, "image"],
  [/\.(mp3|wav|flac|aac|ogg|m4a)$/i, "audio"],
  [/\.(mp4|mov|mkv|avi|webm|wmv)$/i, "video"],
  [/\.(js|jsx|ts|tsx|go|py|rs|java|c|cpp|h|cs|rb|php|sh|ps1|json|ya?ml|toml|html|css|sql|lua|gd|kt|swift)$/i, "code"],
];

function iconOf(name: string, dir: boolean): string {
  if (dir) return ICONS.folder;
  for (const [re, kind] of KINDS) if (re.test(name)) return ICONS[kind];
  return ICONS.file;
}

function span(cls: string, text = ""): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = cls;
  if (text) el.textContent = text;
  return el;
}

/** The files of one line, as cards. */
class FilesWidget extends WidgetType {
  constructor(readonly refs: { name: string; link: string }[]) {
    super();
  }
  eq(other: FilesWidget) {
    return other.refs.length === this.refs.length && other.refs.every((r, i) => r.link === this.refs[i]!.link && r.name === this.refs[i]!.name);
  }
  get estimatedHeight() {
    return this.refs.length * 60;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "cm-md-files";
    this.refs.forEach((r, i) => box.append(card(view, box, r, i)));
    return box;
  }
  ignoreEvent(e: Event) {
    return e.target instanceof Element && !!e.target.closest(".cm-md-file");
  }
}

function card(view: EditorView, box: HTMLElement, ref: { name: string; link: string }, index: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "cm-md-file";
  el.dataset.loading = "";
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", `打开 ${ref.name}`);
  if (ref.link.startsWith("attachment:")) el.dataset.stored = "";

  const icon = span("cm-md-file-icon");
  icon.innerHTML = iconOf(ref.name, false);
  const body = span("cm-md-file-body");
  const name = span("cm-md-file-name", ref.name || "文件");
  name.title = ref.name;
  const meta = span("cm-md-file-meta");
  body.append(name, meta);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "cm-md-file-remove";
  remove.setAttribute("aria-label", "删除");
  remove.title = "从备注里删除（不删文件）";
  remove.innerHTML = xIcon;
  el.append(icon, body, remove);

  let info: FileInfo | null = null;
  void infoOf(ref.link).then((i) => {
    info = i;
    delete el.dataset.loading;
    icon.innerHTML = iconOf(i.name || ref.name, i.dir);
    meta.replaceChildren();
    const badge = span("cm-md-file-badge");
    badge.innerHTML = i.stored ? storedIcon : linkedIcon;
    badge.append(i.stored ? "已另存" : "原地");
    meta.append(badge);
    if (!i.exists) {
      el.dataset.missing = "";
      meta.append(span("cm-md-file-missing", "文件不见了"));
      return;
    }
    meta.append(span("cm-md-file-size", i.dir ? "文件夹" : formatBytes(i.size)));
    if (!i.stored && i.folder) {
      const where = span("cm-md-file-where", i.folder);
      where.title = i.path;
      meta.append(where);
    }
  });

  el.addEventListener("mousedown", (e) => {
    // Keep the focus and the cursor where they are.
    if (e.button === 0) e.preventDefault();
  });
  el.addEventListener("click", (e) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest(".cm-md-file-remove")) {
      removeFile(view, box, index);
      return;
    }
    if (el.dataset.missing !== undefined) {
      toast.error("找不到这个文件，它可能已经被移走或删除");
      return;
    }
    void run(Atlas.openAttachment(ref.link));
  });
  el.dataset.ownMenu = "";
  el.addEventListener("contextmenu", (e) => {
    const exists = !!info?.exists;
    const entries: MenuEntries = [];
    if (exists) {
      entries.push(
        { label: "打开", icon: ExternalLink, run: () => void run(Atlas.openAttachment(ref.link)) },
        { label: "打开文件夹位置", icon: FolderOpen, run: () => void run(Atlas.showAttachmentInFolder(ref.link)) },
        {
          label: "复制文件",
          icon: Copy,
          run: () => void run(Atlas.copyAttachment(ref.link)).then((r) => r !== undefined && toast.success("已复制文件")),
        },
        null,
      );
    }
    if (info?.stored) {
      entries.push({
        label: "改为原地引用",
        icon: Link2,
        disabled: !info.canUnstore,
        run: () => void switchFile(view, box, index, "unstore"),
      });
    } else if (info) {
      entries.push({
        label: "改为另存到软件",
        icon: HardDrive,
        disabled: !info.canStore,
        run: () => void switchFile(view, box, index, "store"),
      });
    }
    entries.push(null, { label: "删除", icon: Trash2, destructive: true, run: () => box.isConnected && removeFile(view, box, index) });
    if (showPageMenu({ x: e.clientX, y: e.clientY, entries })) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  return el;
}

/** The index-th file of the line box shows, as the text is now. */
function refAt(view: EditorView, box: HTMLElement, index: number): FileRef | undefined {
  if (!box.isConnected) return undefined;
  const line = view.state.doc.lineAt(view.posAtDOM(box));
  return fileLine(view.state, line.from, line.text)[index];
}

/** Takes the index-th file of the line box shows out of the note, and the line with it when nothing else is on it. */
function removeFile(view: EditorView, box: HTMLElement, index: number) {
  const { state } = view;
  const ref = refAt(view, box, index);
  if (!ref) return;
  const line = state.doc.lineAt(ref.from);
  let { from, to } = ref;
  if (fileLine(state, line.from, line.text).length === 1) {
    from = line.from;
    to = line.to;
    if (line.to < state.doc.length) to++;
    else if (line.from > 0) from--;
  } else if (state.sliceDoc(to, to + 1) === " ") {
    to++;
  } else if (state.sliceDoc(from - 1, from) === " ") {
    from--;
  }
  view.dispatch({ changes: { from, to }, userEvent: "delete" });
}

/** Keeps the file in the app, or refers to it where it came from again, in place of its link. */
async function switchFile(view: EditorView, box: HTMLElement, index: number, to: "store" | "unstore") {
  const ref = refAt(view, box, index);
  if (!ref) return;
  const before = view.state.sliceDoc(ref.from, ref.to);
  const item = await run(to === "store" ? Atlas.storeAttachment(ref.link) : Atlas.unstoreAttachment(ref.link));
  if (!item) return;
  // Found again: the text may have changed meanwhile.
  const now = refAt(view, box, index);
  if (!now || view.state.sliceDoc(now.from, now.to) !== before) {
    toast.error("备注已经改动，没有替换链接");
    return;
  }
  infos.delete(item.link);
  view.dispatch({
    changes: { from: now.from, to: now.to, insert: fileMarkdown(now.name, item.link) },
    userEvent: "input",
  });
  toast.success(to === "store" ? "已另存到软件" : "已改为原地引用");
}

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  const hasFocus = state.field(focused);
  const { doc, selection } = state;
  const active = new Set<number>();
  if (hasFocus) {
    for (const r of selection.ranges) {
      const last = doc.lineAt(r.to).number;
      for (let n = doc.lineAt(r.from).number; n <= last; n++) active.add(n);
    }
  }
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const refs = fileLine(state, line.from, line.text);
    if (refs.length === 0) continue;
    const widget = new FilesWidget(refs.map((r) => ({ name: r.name, link: r.link })));
    if (!active.has(n)) out.push(Decoration.replace({ widget, block: true }).range(line.from, line.to));
    else out.push(Decoration.widget({ widget, block: true, side: 1 }).range(line.to));
  }
  return Decoration.set(out, true);
}

function rebuilds(tr: Transaction): boolean {
  return (
    tr.docChanged ||
    tr.selection !== undefined ||
    tr.startState.field(focused) !== tr.state.field(focused) ||
    syntaxTree(tr.startState) !== syntaxTree(tr.state)
  );
}

const cards = StateField.define<DecorationSet>({
  create: (state) => build(state),
  update: (value, tr) => (rebuilds(tr) ? build(tr.state) : value),
  provide: (f) => EditorView.decorations.from(f),
});

/** The cards of files; after images, whose focus they follow. */
export const attachments = [cards];

// ---- Pasting and dropping ----

/** Puts what Go took, pictures on a line and files a line each, at at or the cursor. */
function placeAttached(view: EditorView, res: Attached, at: { from: number; to: number } | null, before: Text) {
  if (res.problems.length > 0) toast.error(res.problems.join("；"));
  if (!view.dom.isConnected) return;
  const pictures = res.items.filter((i) => i.image).map((i) => `![](image:${i.image})`);
  const files = res.items.filter((i) => !i.image).map((i) => fileMarkdown(i.name, i.link));
  const lines = [pictures.join(" "), ...files].filter(Boolean);
  if (lines.length > 0) placeBlock(view, lines.join("\n"), at, before);
}

/** Runs take, saying so when it takes more than a moment. */
async function slowly<T>(take: Promise<T>): Promise<T | undefined> {
  let loading: string | number | undefined;
  const slow = window.setTimeout(() => (loading = toast.loading("正在添加文件…")), 400);
  try {
    return await take;
  } catch (e) {
    toast.error(errorMessage(e));
    return undefined;
  } finally {
    window.clearTimeout(slow);
    if (loading !== undefined) toast.dismiss(loading);
  }
}

/** Pastes the files copied in a file manager, which Go reads with their paths. */
export async function pasteFiles(view: EditorView) {
  const before = view.state.doc;
  const { from, to } = view.state.selection.main;
  const res = await slowly(Atlas.attachClipboardFiles());
  if (res) placeAttached(view, res, { from, to }, before);
}

/** A drop of files, waiting for their paths. */
let pending: { view: EditorView; pos: number; at: number; before: Text } | null = null;

/** Notes a drop of files at pos, whose paths MyGo tells next. */
export function expectFileDrop(view: EditorView, pos: number) {
  pending = { view, pos, at: Date.now(), before: view.state.doc };
}

if (isMyGo()) {
  onFileDrop(({ paths }) => {
    const drop = pending;
    pending = null;
    if (!drop || Date.now() - drop.at > 5000 || paths.length === 0) return;
    void slowly(Atlas.attachFiles(paths)).then(
      (res) => res && placeAttached(drop.view, res, { from: drop.pos, to: drop.pos }, drop.before),
    );
  });
}
