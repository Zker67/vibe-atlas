// Pasted HTML as Markdown, for content copied with pictures in it: from a
// web page, Word or an online document. The pictures become placeholders,
// listed by their sources, for images.ts to save and put in.
//
// DOMParser makes an inert document: no script runs, no picture loads.

/** Markdown with the pictures as placeholders, and where each picture comes from. */
export interface PastedHtml {
  markdown: string;
  sources: string[];
}

/** The placeholder of the index-th picture, which no pasted text has. */
export const placeholder = (index: number) => `\uE000${index}\uE000`;
export const placeholderPattern = /\uE000(\d+)\uE000/g;

// Spaces and line breaks that the clean-up below must keep: indents of
// lists and the text of code blocks.
const SPACE = "\uE001";
const BREAK = "\uE002";

const SKIP = new Set(["head", "script", "style", "meta", "link", "title", "noscript", "template", "svg", "button", "input", "select", "textarea"]);
const BLOCK = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "aside", "nav", "figure", "figcaption",
  "address", "details", "summary", "dl", "dt", "dd", "center", "form", "fieldset",
]);

/** Whether pasted HTML has pictures, which only then is worth turning into Markdown. */
export function hasPictures(html: string): boolean {
  return /<img[\s>]/i.test(html);
}

/** Pasted HTML as Markdown. */
export function htmlToMarkdown(html: string): PastedHtml {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const sources: string[] = [];
  const raw = convert(doc.body, sources);
  const markdown = raw
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replaceAll(SPACE, " ")
    .replaceAll(BREAK, "\n")
    .trim();
  return { markdown, sources };
}

/** A link's address as Markdown may keep it, or "" for one that must not open. */
function safeHref(href: string): string {
  const h = href.trim();
  return /^(https?:|mailto:|file:)/i.test(h) ? h.replace(/[()\s]/g, (c) => encodeURIComponent(c)) : "";
}

/** Text wrapped in marks, the spaces around it kept outside them, as Markdown needs. */
function wrap(text: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : text;
}

/** Block content: separated from what is around it by a blank line. */
const block = (text: string) => `\n\n${text.trim()}\n\n`;

function children(node: Node, sources: string[]): string {
  let out = "";
  node.childNodes.forEach((c) => (out += convert(c, sources)));
  return out;
}

function convert(node: Node, sources: string[]): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (SKIP.has(tag) || el.hidden || /display\s*:\s*none/i.test(el.getAttribute("style") ?? "")) return "";

  switch (tag) {
    case "br":
      return "\n";
    case "hr":
      return block("---");
    case "img": {
      const src = el.getAttribute("src")?.trim() ?? "";
      if (!src) return "";
      sources.push(src);
      return placeholder(sources.length - 1);
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const text = children(el, sources).replace(/\s*\n\s*/g, " ").trim();
      return text ? block(`${"#".repeat(Number(tag[1]))} ${text}`) : "";
    }
    case "strong":
    case "b":
      return wrap(children(el, sources), "**");
    case "em":
    case "i":
      return wrap(children(el, sources), "*");
    case "s":
    case "del":
    case "strike":
      return wrap(children(el, sources), "~~");
    case "code": {
      if (el.closest("pre")) return el.textContent ?? "";
      const text = (el.textContent ?? "").replace(/\s+/g, " ");
      const ticks = text.includes("`") ? "``" : "`";
      return text.trim() ? `${ticks}${text}${ticks}` : "";
    }
    case "pre": {
      const lang = /language-([\w+#-]+)/.exec(el.querySelector("code")?.className ?? el.className)?.[1] ?? "";
      const text = (el.textContent ?? "").replace(/\n+$/, "");
      const fence = text.includes("```") ? "~~~" : "```";
      const body = text.replaceAll(" ", SPACE).replaceAll("\n", BREAK);
      return `\n\n${fence}${lang}${BREAK}${body}${BREAK}${fence}\n\n`;
    }
    case "a": {
      const text = children(el, sources);
      const href = safeHref(el.getAttribute("href") ?? "");
      // A picture that links somewhere stays a picture.
      if (!href || !text.trim() || /\uE000\d+\uE000/.test(text)) return text;
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
      return `${m[1]}[${m[2]!.replace(/\n+/g, " ")}](${href})${m[3]}`;
    }
    case "blockquote": {
      const inner = children(el, sources).trim().replace(/\n{3,}/g, "\n\n");
      return inner ? block(inner.split("\n").map((l) => (l.trim() ? `> ${l}` : ">")).join("\n")) : "";
    }
    case "ul":
    case "ol":
      return block(list(el, sources, tag === "ol"));
    case "li":
      // Outside a list, as some editors copy a single item.
      return block(`- ${children(el, sources).trim()}`);
    case "table":
      return block(table(el, sources));
  }
  const inner = children(el, sources);
  return BLOCK.has(tag) ? block(inner) : inner;
}

/** A list, its items' further lines and nested lists indented under them. */
function list(el: HTMLElement, sources: string[], ordered: boolean): string {
  const start = Number(el.getAttribute("start")) || 1;
  const lines: string[] = [];
  let n = 0;
  for (const li of el.children) {
    if (li.tagName.toLowerCase() !== "li") continue;
    const marker = ordered ? `${start + n}. ` : "- ";
    n++;
    const task = li.querySelector(':scope > input[type="checkbox"]') as HTMLInputElement | null;
    const box = task ? (task.checked ? "[x] " : "[ ] ") : "";
    const text = children(li, sources).trim().replace(/\n{2,}/g, "\n");
    const indent = SPACE.repeat(marker.length);
    const [first = "", ...rest] = text.split("\n");
    lines.push(marker + box + first, ...rest.map((l) => indent + l));
  }
  return lines.join("\n");
}

/** A table as a GFM table, its first row the header. */
function table(el: HTMLElement, sources: string[]): string {
  const rows = [...el.querySelectorAll("tr")].map((tr) =>
    [...tr.children].map((cell) => children(cell, sources).replace(/\s*\n\s*/g, " ").replaceAll("|", "\\|").trim()),
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  return [line(rows[0]!), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}
