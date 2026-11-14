import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { Atlas, type Session } from "@/mygo";
import { parseSessionLink, shortId, SOURCE_NAMES, type SessionLink } from "@/lib/session-link";

// The sessions that links on the page open, found by Go in each link's
// source, to show their names. Looked up as links show, several at once,
// and looked up again after a while, when the window comes back to the
// front: sessions are renamed meanwhile.

interface Found {
  session: Session | null;
  /** When it was looked up; 0 once it should be looked up again. */
  at: number;
}

const useFound = create<{ found: Readonly<Record<string, Found>> }>(() => ({ found: {} }));

/** How long a name found stays good. */
const FRESH = 60_000;

const waiting = new Set<string>();
const asking = new Set<string>();
let timer = 0;

function lookUp(link: string) {
  if (asking.has(link)) return;
  waiting.add(link);
  if (!timer) timer = window.setTimeout(() => void ask(), 0);
}

async function ask() {
  timer = 0;
  const links = [...waiting];
  waiting.clear();
  for (const l of links) asking.add(l);
  let found: Record<string, Session> = {};
  try {
    found = (await Atlas.sessionsOf(links)) ?? {};
  } catch {
    // Unreadable now: the links show without names, until looked up again.
  }
  const at = Date.now();
  useFound.setState((s) => {
    const next = { ...s.found };
    for (const l of links) next[l] = { session: found[l] ?? null, at };
    return { found: next };
  });
  for (const l of links) asking.delete(l);
}

/** Has every name looked up again as its link next shows; the names shown stay meanwhile. */
function stale() {
  useFound.setState((s) => {
    const next: Record<string, Found> = {};
    for (const [l, f] of Object.entries(s.found)) next[l] = { ...f, at: 0 };
    return { found: next };
  });
}

window.addEventListener("focus", stale);

/** Keeps a session just picked, so that its name shows at once. */
export function rememberSession(session: Session) {
  useFound.setState((s) => ({ found: { ...s.found, [session.link]: { session, at: Date.now() } } }));
}

/** How a link to a session shows. */
export interface SessionLook {
  link: SessionLink;
  /** The session, once found in the link's source; null before, or when it is not there. */
  session: Session | null;
  /** The agent whose icon shows. */
  agent: string;
}

/** The name a link to a session shows: the session's, else its source and short ID. */
export function sessionLabel(look: SessionLook): string {
  return look.session?.title || `${SOURCE_NAMES[look.link.source]} 会话 ${shortId(look.link.id)}`;
}

/** How link shows when it opens a session, kept up to date; null for other links. */
export function useSessionLook(link: string): SessionLook | null {
  const parsed = useMemo(() => parseSessionLink(link), [link]);
  const found = useFound((s) => (parsed ? s.found[link] : undefined));
  useEffect(() => {
    if (parsed && (!found || Date.now() - found.at > FRESH)) lookUp(link);
  }, [parsed, link, found]);
  if (!parsed) return null;
  const session = found?.session ?? null;
  return { link: parsed, session, agent: session?.agent ?? parsed.agent };
}
