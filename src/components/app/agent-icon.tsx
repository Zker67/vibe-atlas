import { useId } from "react";
import { cn } from "@/lib/utils";

// The marks of the agents, as codeg draws them (src/components/agent-icon.tsx
// of spacering-net/codeg, Apache-2.0; see
// references/external-repos/spacering-net__codeg). The marks belong to their
// makers and only show which agent a session talks to.

function ClaudeMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-full">
      <path
        clipRule="evenodd"
        fillRule="evenodd"
        fill="#D97757"
        d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"
      />
    </svg>
  );
}

function CodexMark() {
  const id = useId();
  return (
    <svg viewBox="2 2 20 20" aria-hidden className="size-full">
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="12" x2="12" y1="3" y2="21">
          <stop stopColor="#B1A7FF" />
          <stop offset=".5" stopColor="#7A9DFF" />
          <stop offset="1" stopColor="#3941FF" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${id})`}
        d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z"
      />
    </svg>
  );
}

function GeminiMark() {
  const id = useId();
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-full">
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="24" x2="0" y1="6.587" y2="16.494">
          <stop stopColor="#EE4D5D" />
          <stop offset=".328" stopColor="#B381DD" />
          <stop offset=".476" stopColor="#207CFE" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${id})`}
        d="M0 4.391A4.391 4.391 0 014.391 0h15.217A4.391 4.391 0 0124 4.391v15.217A4.391 4.391 0 0119.608 24H4.391A4.391 4.391 0 010 19.608V4.391z"
      />
      <path
        clipRule="evenodd"
        fillRule="evenodd"
        fill="#1E1E2E"
        d="M19.74 1.444a2.816 2.816 0 012.816 2.816v15.48a2.816 2.816 0 01-2.816 2.816H4.26a2.816 2.816 0 01-2.816-2.816V4.26A2.816 2.816 0 014.26 1.444h15.48zM7.236 8.564l7.752 3.728-7.752 3.727v2.802l9.557-4.596v-3.866L7.236 5.763v2.801z"
      />
    </svg>
  );
}

/** codeg's own mark: angle brackets round three dots. */
function CodegMark() {
  return (
    <svg viewBox="0 0 512 512" aria-hidden className="size-full">
      <rect width="512" height="512" rx="90" fill="#1a1a2e" />
      <g fill="none" stroke="#d5d8e6" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="180,186 100,256 180,326" />
        <polyline points="332,186 412,256 332,326" />
      </g>
      <circle cx="206" cy="256" r="30" fill="#ec407a" />
      <circle cx="256" cy="256" r="36" fill="#fbe13c" />
      <circle cx="306" cy="256" r="30" fill="#1eaff5" />
    </svg>
  );
}

const NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  codeg: "codeg",
};

/** The agent's name, for tooltips: its own for those codeg names otherwise. */
export function agentName(agent: string): string {
  return NAMES[agent] ?? agent;
}

/**
 * The mark of the agent a session talks to: Claude, Codex (GPT), Gemini;
 * codeg's own for the other agents codeg runs, and for a codeg session not
 * found yet.
 */
export function AgentIcon({ agent, className }: { agent: string; className?: string }) {
  const Mark = agent === "claude" ? ClaudeMark : agent === "codex" ? CodexMark : agent === "gemini" ? GeminiMark : CodegMark;
  return (
    <span className={cn("inline-grid size-3.5 shrink-0 place-items-center", className)}>
      <Mark />
    </span>
  );
}
