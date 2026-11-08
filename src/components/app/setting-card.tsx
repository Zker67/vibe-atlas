import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** One setting: its name over its control, what it does in a tooltip by the name, and an action beside it. */
export function SettingCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg bg-card p-4 ring-1 ring-foreground/[0.07]">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`${title}的说明`}
                  className="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{description}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {action && <div className="-mt-1 -mr-1 shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
