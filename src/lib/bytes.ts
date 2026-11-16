const UNITS = ["KB", "MB", "GB", "TB"];

/** A size for people: 512 B, 3.4 KB, 12 MB, 1.25 GB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  let n = bytes / 1024;
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit++;
  }
  const digits = n >= 100 ? 0 : n >= 10 ? 1 : 2;
  return `${Number(n.toFixed(digits))} ${UNITS[unit]}`;
}
