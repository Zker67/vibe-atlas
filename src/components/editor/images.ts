// Pictures in notes: ![](image:<name>), a picture Go keeps in the data
// folder (images.go). Pasted or dropped pictures are saved and put on a
// line of their own; several at once share it and show side by side. Other
// files pasted or dropped go to attachments.ts.
// A line of pictures shows as the pictures alone, and while the cursor is
// on it as its Markdown with the pictures under it, so nothing jumps.
// Pictures on the web, ![](https://…), show as cards too, but load only
// once the user asks: opening a note goes on no network.

import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateEffect, StateField, type Text, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, dropCursor, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api";
import { Atlas } from "@/mygo";
import { expectFileDrop, pasteFiles } from "./attachments";
import { hasPictures, htmlToMarkdown, placeholderPattern } from "./paste-html";
import { copyText } from "./live-preview";
import { showPictureMenu, showWebPictureMenu } from "./picture-menu";

const maxBytes = 20 << 20;
const types = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"]);

/**
 * A picture's Markdown: the name of one of the app in group 2, or the
 * address of one on the web, in angle brackets (3) or not (4).
 */
const refPattern =
  /!\[([^\]\n]*)\]\((?:image:([0-9a-f]{16}\.(?:png|jpg|webp|gif|bmp))|<(https?:\/\/[^<>\n]+)>|(https?:\/\/[^\s()<>]+))\)/g;

export interface ImageRef {
  from: number;
  to: number;
  /** The name of a picture of the app, "" for one on the web. */
  name: string;
  /** The address of a picture on the web, "" for one of the app. */
  url: string;
}

/** Whether a picture's URL, as written, shows as a card: one of the app's, or one on the web. */
export function isCardPicture(url: string): boolean {
  return /^image:[0-9a-f]{16}\.(?:png|jpg|webp|gif|bmp)$/.test(url) || /^<?https?:\/\//i.test(url);
}

let base = "";
const baseReady = Atlas.imageBase().then(
  (b) => {
    base = b;
  },
  () => {},
);

/** Sets img to show the picture name, once the address of pictures is known. */
function load(img: HTMLImageElement, name: string) {
  if (base) img.src = base + name;
  else void baseReady.then(() => (img.src = base + name));
}

/** The sizes of the pictures seen, to keep the editor's heights right before they load. */
const sizes = new Map<string, { w: number; h: number }>();

const codeNodes = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText"]);

/** Whether pos is in code, where Markdown is text. */
export function inCode(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (codeNodes.has(node.name)) return true;
  }
  return false;
}

/** The pictures on a line, outside code. */
function refsIn(state: EditorState, from: number, text: string): ImageRef[] {
  if (!text.includes("image:") && !text.includes("http")) return [];
  const out: ImageRef[] = [];
  for (const m of text.matchAll(refPattern)) {
    const at = from + m.index;
    if (!inCode(state, at)) out.push({ from: at, to: at + m[0].length, name: m[2] ?? "", url: m[3] ?? m[4] ?? "" });
  }
  return out;
}

/** Whether a line has nothing but pictures. */
function onlyPictures(text: string, refs: ImageRef[], lineFrom: number): boolean {
  let rest = "";
  let pos = lineFrom;
  for (const r of refs) {
    rest += text.slice(pos - lineFrom, r.from - lineFrom);
    pos = r.to;
  }
  rest += text.slice(pos - lineFrom);
  return refs.length > 0 && rest.trim() === "";
}

/** The names of the pictures in the document, in order, each once: what the viewer pages through. */
export function picturesIn(state: EditorState): string[] {
  const names: string[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    for (const r of refsIn(state, line.from, line.text)) if (r.name && !names.includes(r.name)) names.push(r.name);
  }
  return names;
}

/** Whether the picture at pos stands on a line of pictures, which the block widget covers. */
export function onPictureLine(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return onlyPictures(line.text, refsIn(state, line.from, line.text), line.from);
}

const setFocused = StateEffect.define<boolean>();

/** Whether the editor has the focus, which the cards of a line wait for. */
export const focused = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFocused)) value = e.value;
    return value;
  },
});

const xIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const missingIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m2 2 20 20"/><path d="M10.41 10.41a2 2 0 1 1-2.83-2.83"/><path d="M13.5 13.5 6 21"/><path d="M18 12l3 3"/><path d="M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59"/><path d="M21 15V5a2 2 0 0 0-2-2H9"/></svg>';

const globeIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';

/**
 * The pictures of one line, as cards side by side: each the name of a
 * picture of the app, or the address of one on the web.
 */
class PicturesWidget extends WidgetType {
  constructor(readonly srcs: string[]) {
    super();
  }
  eq(other: PicturesWidget) {
    return other.srcs.join() === this.srcs.join();
  }
  get estimatedHeight() {
    const known = this.srcs.map((n) => sizes.get(n));
    if (this.srcs.length === 1 && known[0]) return Math.min(known[0].h, 320) + 12;
    return this.srcs.length === 1 ? 200 : 156;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "cm-md-pictures";
    box.dataset.count = this.srcs.length > 1 ? "many" : "one";
    this.srcs.forEach((src, i) => box.append(isWeb(src) ? webCard(view, box, src, i) : card(view, box, src, i)));
    return box;
  }
  ignoreEvent(e: Event) {
    // The cards are the widget's own; clicks beside them put the cursor on the line.
    return e.target instanceof Element && !!e.target.closest(".cm-md-picture");
  }
}

function card(view: EditorView, box: HTMLElement, name: string, index: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "cm-md-picture";
  el.dataset.loading = "";
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", "查看大图");
  const size = sizes.get(name);
  if (size) el.style.setProperty("--ratio", `${size.w} / ${size.h}`);

  const img = document.createElement("img");
  img.alt = "";
  img.decoding = "async";
  img.draggable = false;
  img.addEventListener("load", () => {
    const first = !sizes.has(name);
    sizes.set(name, { w: img.naturalWidth, h: img.naturalHeight });
    el.style.setProperty("--ratio", `${img.naturalWidth} / ${img.naturalHeight}`);
    delete el.dataset.loading;
    if (first) el.dataset.appear = "";
    view.requestMeasure();
  });
  img.addEventListener("error", () => {
    delete el.dataset.loading;
    el.dataset.missing = "";
    el.setAttribute("aria-label", "图片不见了");
    const note = document.createElement("span");
    note.className = "cm-md-picture-missing";
    note.innerHTML = missingIcon;
    note.append("图片不见了");
    el.append(note);
    view.requestMeasure();
  });
  load(img, name);

  el.append(img, removeButton());
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    // Keep the focus and the cursor where they are.
    e.preventDefault();
  });
  const viewLarge = () => {
    const names = picturesIn(view.state);
    void import("./image-viewer").then((m) => m.openImageViewer(names, Math.max(0, names.indexOf(name)), base));
  };
  el.addEventListener("click", (e) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest(".cm-md-picture-remove")) {
      removePicture(view, box, index);
      return;
    }
    if (el.dataset.missing !== undefined) return;
    viewLarge();
  });
  // The picture's menu, not the text's around it.
  el.dataset.ownMenu = "";
  el.addEventListener("contextmenu", (e) => {
    showPictureMenu(e, name, {
      missing: el.dataset.missing !== undefined,
      view: viewLarge,
      remove: () => box.isConnected && removePicture(view, box, index),
    });
  });
  return el;
}

const isWeb = (src: string) => /^https?:/i.test(src);

/** Pictures on the web loaded in this run: the user asked for them. */
const loadedWeb = new Set<string>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function removeButton(): HTMLButtonElement {
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "cm-md-picture-remove";
  remove.setAttribute("aria-label", "删除图片");
  remove.title = "删除图片";
  remove.innerHTML = xIcon;
  return remove;
}

/** The card of a picture on the web: a placeholder until the user loads it. */
function webCard(view: EditorView, box: HTMLElement, url: string, index: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "cm-md-picture";
  el.dataset.web = "";
  el.setAttribute("role", "button");
  const remove = removeButton();

  const show = () => {
    loadedWeb.add(url);
    delete el.dataset.placeholder;
    el.querySelector(".cm-md-picture-web")?.remove();
    el.dataset.loading = "";
    el.setAttribute("aria-label", "网络图片");
    const size = sizes.get(url);
    if (size) el.style.setProperty("--ratio", `${size.w} / ${size.h}`);
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.draggable = false;
    // Hosts that turn away pictures shown on other sites often let those with no referrer through.
    img.referrerPolicy = "no-referrer";
    img.addEventListener("load", () => {
      const first = !sizes.has(url);
      sizes.set(url, { w: img.naturalWidth, h: img.naturalHeight });
      el.style.setProperty("--ratio", `${img.naturalWidth} / ${img.naturalHeight}`);
      delete el.dataset.loading;
      if (first) el.dataset.appear = "";
      view.requestMeasure();
    });
    img.addEventListener("error", () => {
      delete el.dataset.loading;
      el.dataset.missing = "";
      el.setAttribute("aria-label", "加载不了这张图片");
      const note = document.createElement("span");
      note.className = "cm-md-picture-missing";
      note.innerHTML = missingIcon;
      note.append("加载不了这张图片");
      el.append(note);
      view.requestMeasure();
    });
    img.src = url;
    el.prepend(img);
    view.requestMeasure();
  };

  if (loadedWeb.has(url)) {
    show();
  } else {
    el.dataset.placeholder = "";
    el.setAttribute("aria-label", "加载网络图片");
    const ph = document.createElement("span");
    ph.className = "cm-md-picture-web";
    const icon = document.createElement("span");
    icon.className = "cm-md-picture-web-icon";
    icon.innerHTML = globeIcon;
    const title = document.createElement("span");
    title.className = "cm-md-picture-web-title";
    title.textContent = "网络图片";
    const host = document.createElement("span");
    host.className = "cm-md-picture-web-host";
    host.textContent = hostOf(url);
    host.title = url;
    const actions = document.createElement("span");
    actions.className = "cm-md-picture-web-actions";
    for (const [act, label] of [
      ["load", "加载"],
      ["save", "保存到本地"],
    ] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.act = act;
      b.textContent = label;
      actions.append(b);
    }
    ph.append(icon, title, host, actions);
    el.append(ph);
  }
  el.append(remove);

  el.addEventListener("mousedown", (e) => {
    // Keep the focus and the cursor where they are.
    if (e.button === 0) e.preventDefault();
  });
  el.addEventListener("click", (e) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest(".cm-md-picture-remove")) {
      removePicture(view, box, index);
      return;
    }
    if (target.closest('[data-act="save"]')) {
      void saveWebPicture(view, box, index, url);
      return;
    }
    if (el.dataset.placeholder !== undefined) show();
  });
  el.dataset.ownMenu = "";
  el.addEventListener("contextmenu", (e) => {
    showWebPictureMenu(e, {
      loaded: el.dataset.placeholder === undefined,
      load: show,
      save: () => void saveWebPicture(view, box, index, url),
      open: () => void Atlas.openLink(url).catch((err: unknown) => toast.error(errorMessage(err))),
      copy: () => void copyText(url).then(() => toast.success("已复制图片地址")),
      remove: () => box.isConnected && removePicture(view, box, index),
    });
  });
  return el;
}

/** The picture at url, the index-th of the line box shows, or else the first in the note. */
function webRef(view: EditorView, box: HTMLElement, index: number, url: string): ImageRef | undefined {
  const { state } = view;
  if (box.isConnected) {
    const line = state.doc.lineAt(view.posAtDOM(box));
    const ref = refsIn(state, line.from, line.text)[index];
    if (ref?.url === url) return ref;
  }
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const ref = refsIn(state, line.from, line.text).find((r) => r.url === url);
    if (ref) return ref;
  }
  return undefined;
}

/** Downloads the picture at url into the app and refers to it there instead. */
async function saveWebPicture(view: EditorView, box: HTMLElement, index: number, url: string) {
  let loading: string | number | undefined;
  const slow = window.setTimeout(() => (loading = toast.loading("正在保存图片…")), 400);
  let name: string;
  try {
    name = await Atlas.saveImageFrom(url);
  } catch (e) {
    toast.error(errorMessage(e));
    return;
  } finally {
    window.clearTimeout(slow);
    if (loading !== undefined) toast.dismiss(loading);
  }
  if (!view.dom.isConnected) return;
  const ref = webRef(view, box, index, url);
  if (!ref) {
    toast.error("备注已经改动，没有替换图片");
    return;
  }
  const alt = /^!\[([^\]\n]*)\]/.exec(view.state.sliceDoc(ref.from, ref.to))?.[1] ?? "";
  view.dispatch({ changes: { from: ref.from, to: ref.to, insert: `![${alt}](image:${name})` }, userEvent: "input" });
  toast.success("已保存到本地");
}

/** Deletes the index-th picture of the line box shows, and the line with it when nothing else is on it. */
function removePicture(view: EditorView, box: HTMLElement, index: number) {
  const { state } = view;
  const line = state.doc.lineAt(view.posAtDOM(box));
  const refs = refsIn(state, line.from, line.text);
  const ref = refs[index];
  if (!ref) return;
  let { from, to } = ref;
  if (refs.length === 1 && onlyPictures(line.text, refs, line.from)) {
    // The whole line goes, with one of its line breaks.
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
    const refs = refsIn(state, line.from, line.text);
    if (refs.length === 0) continue;
    const widget = new PicturesWidget(refs.map((r) => r.name || r.url));
    if (!active.has(n) && onlyPictures(line.text, refs, line.from)) {
      out.push(Decoration.replace({ widget, block: true }).range(line.from, line.to));
    } else {
      out.push(Decoration.widget({ widget, block: true, side: 1 }).range(line.to));
    }
  }
  return Decoration.set(out, true);
}

function rebuilds(tr: Transaction): boolean {
  return (
    tr.docChanged ||
    tr.selection !== undefined ||
    tr.effects.some((e) => e.is(setFocused)) ||
    syntaxTree(tr.startState) !== syntaxTree(tr.state)
  );
}

/** The cards: block widgets, which CodeMirror takes only from a state field. */
const pictures = StateField.define<DecorationSet>({
  create: (state) => build(state),
  update: (value, tr) => (rebuilds(tr) ? build(tr.state) : value),
  provide: (f) => EditorView.decorations.from(f),
});

function imageFiles(files: FileList | undefined | null): File[] {
  return [...(files ?? [])].filter((f) => types.has(f.type));
}

function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // A data URL: its base64 after the comma.
    reader.addEventListener("load", () => resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1)));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("读不了这张图片")));
    reader.readAsDataURL(file);
  });
}

/** Saves the pictures and puts them, side by side, on a line of their own at from–to. */
async function insertPictures(view: EditorView, files: File[], at: { from: number; to: number } | null) {
  const before = view.state.doc;
  const names: string[] = [];
  for (const file of files) {
    if (file.size > maxBytes) {
      toast.error(`图片不能超过 ${maxBytes >> 20} MB`);
      continue;
    }
    try {
      names.push(await Atlas.saveImage(await toBase64(file)));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  if (names.length === 0 || !view.dom.isConnected) return;
  placePictures(view, names, at, before);
}

/**
 * Puts saved pictures, side by side, on a line of their own at from–to, or
 * at the selection; there too when the text changed since before.
 */
function placePictures(view: EditorView, names: string[], at: { from: number; to: number } | null, before: Text) {
  placeBlock(
    view,
    names.map((n) => `![](image:${n})`).join(" "),
    at,
    before,
  );
}

/**
 * Puts block, lines of pictures or files, on lines of its own at from–to,
 * or at the selection; there too when the text changed since before.
 */
export function placeBlock(view: EditorView, block: string, at: { from: number; to: number } | null, before: Text) {
  const { state } = view;
  const main = state.selection.main;
  // Typed on meanwhile: the pictures go where the cursor is now.
  const range = at && state.doc === before ? at : { from: main.from, to: main.to };
  const { doc } = state;
  const startLine = doc.lineAt(range.from);
  const endLine = doc.lineAt(range.to);
  const head = doc.sliceString(startLine.from, range.from);
  const tail = doc.sliceString(range.to, endLine.to);
  const prefix = head.trim() ? "\n" : "";
  const newline = tail.trim() !== "" || range.to === doc.length;
  const insert = prefix + block + (newline ? "\n" : "");
  // The cursor goes to the start of the next line, so that the pictures show at once.
  const cursor = newline ? range.from + insert.length : range.from + insert.length + tail.length + 1;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: cursor },
    scrollIntoView: true,
    userEvent: "input.paste",
  });
  view.focus();
}

/** Asks for pictures on this machine and puts them in at the cursor, on a line of their own. */
export async function choosePictures(view: EditorView) {
  const before = view.state.doc;
  const at = view.state.selection.main.head;
  let names: string[];
  try {
    names = await Atlas.chooseImages();
  } catch (e) {
    toast.error(errorMessage(e));
    return;
  }
  if (names.length === 0 || !view.dom.isConnected) return;
  placePictures(view, names, { from: at, to: at }, before);
}

/** Saves the picture a pasted source refers to, or file, the picture itself: its name, or "" when it could not be. */
async function saveSource(src: string, file: File | undefined): Promise<string> {
  try {
    if (file) return await Atlas.saveImage(await toBase64(file));
    const inline = /^data:image\/[\w.+-]+;base64,([\s\S]*)$/i.exec(src);
    if (inline) return await Atlas.saveImage(inline[1]!.replace(/\s+/g, ""));
    if (/^(https?|file):/i.test(src)) return await Atlas.saveImageFrom(src);
  } catch {
    // Told of below, with the others.
  }
  return "";
}

/**
 * Pastes content copied with pictures in it, as Markdown: the pictures are
 * saved and put where they were. A picture that could not be saved stays a
 * link to where it came from, when that is on the web.
 */
async function pasteHtml(view: EditorView, html: string, files: File[]) {
  const before = view.state.doc;
  const { from, to } = view.state.selection.main;
  const { markdown, sources } = htmlToMarkdown(html);
  // A picture copied from a browser or Word comes as its file too: the surest copy of it.
  const file = sources.length === 1 && files.length === 1 ? files[0] : undefined;
  let loading: string | number | undefined;
  const slow = window.setTimeout(() => (loading = toast.loading("正在保存粘贴的图片…")), 400);
  const names = await Promise.all(sources.map((src) => saveSource(src, file)));
  window.clearTimeout(slow);
  if (loading !== undefined) toast.dismiss(loading);
  if (!view.dom.isConnected) return;

  let kept = 0;
  const failed = names.filter((n) => !n).length;
  if (!markdown.replace(placeholderPattern, "").trim()) {
    // Only pictures: on a line of their own, as pictures pasted alone.
    const saved = names.filter(Boolean);
    if (saved.length > 0) placePictures(view, saved, { from, to }, before);
  } else {
    const text = markdown.replace(placeholderPattern, (_, i: string) => {
      const name = names[Number(i)];
      if (name) return `![](image:${name})`;
      const src = sources[Number(i)]!;
      if (!/^https?:/i.test(src)) return "";
      kept++;
      return `![](${src.replace(/[()\s]/g, (c) => encodeURIComponent(c))})`;
    });
    const range = view.state.doc === before ? { from, to } : view.state.selection.main;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: { anchor: range.from + text.length },
      scrollIntoView: true,
      userEvent: "input.paste",
    });
    view.focus();
  }
  if (failed > 0) toast.error(`有 ${failed} 张图片没能保存${kept > 0 ? "，保留了它们原来的链接" : ""}`);
}

const handlers = EditorView.domEventHandlers({
  paste(e, view) {
    const data = e.clipboardData;
    if (!data) return false;
    const all = data.files?.length ?? 0;
    const files = imageFiles(data.files);
    // Content with pictures in it, as Markdown; into a code block, as text.
    const html = data.getData("text/html");
    if (html && hasPictures(html) && !inCode(view.state, view.state.selection.main.from)) {
      e.preventDefault();
      void pasteHtml(view, html, files);
      return true;
    }
    // Copied from a document, text comes with a picture of it: the text wins.
    if (data.getData("text/plain").trim()) return false;
    e.preventDefault();
    if (files.length > 0 && files.length === all) void insertPictures(view, files, null);
    // Files that are not pictures, or nothing the page can read: the files
    // copied in a file manager, which Go reads with their paths.
    else void pasteFiles(view);
    return true;
  },
  drop(e, view) {
    const all = e.dataTransfer?.files;
    if (!all || all.length === 0) return false;
    e.preventDefault();
    const files = imageFiles(all);
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
    // Other files: MyGo tells their paths just after (attachments.ts).
    if (files.length < all.length) expectFileDrop(view, pos);
    else void insertPictures(view, files, { from: pos, to: pos });
    return true;
  },
});

export const images = [
  focused,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
  pictures,
  handlers,
  dropCursor(),
];
