import type { Source } from "@/mygo";

/** A link that opens a session, as internal/sessions/links.go writes them. */
export interface SessionLink {
  source: Exclude<Source, "">;
  id: string;
  /** The agent the icon shows before the session is found: codeg's own until it says which. */
  agent: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[0-9A-Za-z._-]{1,128}$/;

const FORMS: { source: SessionLink["source"]; prefix: string; agent: string }[] = [
  { source: "codeg", prefix: "codeg://session/", agent: "codeg" },
  { source: "codex", prefix: "codex://threads/", agent: "codex" },
  { source: "claude", prefix: "claude-session:", agent: "claude" },
];

/** The session a link opens, or null when it opens something else. Only reads the link. */
export function parseSessionLink(link: string): SessionLink | null {
  const s = link.trim();
  for (const f of FORMS) {
    if (s.length <= f.prefix.length || s.slice(0, f.prefix.length).toLowerCase() !== f.prefix) continue;
    let id = s.slice(f.prefix.length).replace(/\/+$/, "");
    try {
      id = decodeURIComponent(id);
    } catch {
      return null;
    }
    if (!ID.test(id) || (f.source === "claude" && !UUID.test(id))) return null;
    return { source: f.source, id, agent: f.agent };
  }
  return null;
}

/** The names of the sources, for the settings and what the pages say. */
export const SOURCE_NAMES: Record<SessionLink["source"], string> = {
  claude: "Claude Code",
  codex: "Codex",
  codeg: "codeg",
};

/** A short form of a session's ID, to show while its name is not known. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
