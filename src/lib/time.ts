import { useSyncExternalStore } from "react";

const DAY = 24 * 60 * 60 * 1000;

let clock = Date.now();
const listeners = new Set<() => void>();
let timer = 0;

function subscribe(onTick: () => void) {
  listeners.add(onTick);
  if (!timer) {
    clock = Date.now();
    timer = window.setInterval(() => {
      clock = Date.now();
      for (const l of listeners) l();
    }, 30_000);
  }
  return () => {
    listeners.delete(onTick);
    if (!listeners.size) {
      window.clearInterval(timer);
      timer = 0;
    }
  };
}

/** The time now, which moves on every half minute: for 「5 分钟」 and the like. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => clock);
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 今天 14:05, 昨天 14:05, 11月5日 14:05, or 2025年11月5日. */
export function formatTime(ms: number, now = Date.now()): string {
  if (!ms) return "";
  const d = new Date(ms);
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
  if (days === 0) return `今天 ${hhmm(d)}`;
  if (days === 1) return `昨天 ${hhmm(d)}`;
  if (d.getFullYear() === new Date(now).getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm(d)}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** The day a time falls on, as a key: 2026-11-07, in local time. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 今天, 昨天, 11月5日 周三, or 2025年11月5日 周三. */
export function dayLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  const date =
    d.getFullYear() === new Date(now).getFullYear()
      ? `${d.getMonth() + 1}月${d.getDate()}日`
      : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${date} ${WEEKDAYS[d.getDay()]}`;
}

/** How long ago a time was: 刚刚, 5 分钟, 2 小时, 3 天. */
export function elapsed(ms: number, now = Date.now()): string {
  if (!ms) return "";
  const m = Math.floor((now - ms) / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时`;
  return `${Math.floor(h / 24)} 天`;
}
