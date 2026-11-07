import type { ReactNode } from "react";

/** One setting: its name and what it does over its control, and an action beside the name. */
export function SettingCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg bg-card p-4 ring-1 ring-foreground/[0.07]">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="-mt-1 -mr-1 shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
