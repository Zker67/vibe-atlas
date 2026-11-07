import type { ReactNode } from "react";

/**
 * The side navigation of 设置 and 使用说明: items h-8, one under another
 * with gap-0.5, over a highlight that slides to the active one.
 */
export const NAV_ITEM =
  "group/nav relative z-10 flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[active=true]:text-foreground data-[state=active]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-200 hover:[&_svg]:scale-110";

/** One item's height and the gap under it, in rem: h-8 + gap-0.5. */
const STEP = 2.125;

/** The highlight under the active item, at `index`. */
export function NavIndicator({ index }: { index: number }) {
  if (index < 0) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-8 rounded-md bg-foreground/[0.07] shadow-xs ring-1 ring-foreground/[0.06] transition-transform duration-[var(--spring-pop-duration)] ease-[var(--spring-pop)] motion-reduce:transition-none"
      style={{ transform: `translateY(${index * STEP}rem)` }}
    />
  );
}

/** The left column of a dialog with side navigation. */
export function NavColumn({ children }: { children: ReactNode }) {
  return <aside className="flex w-48 shrink-0 flex-col gap-3 border-r bg-muted/40 p-3">{children}</aside>;
}

/** The small heading over a group of items. */
export function NavLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 text-xs font-medium text-muted-foreground">{children}</div>;
}
