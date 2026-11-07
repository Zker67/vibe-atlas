import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface IconButtonProps extends Omit<ComponentProps<typeof Button>, "size"> {
  /** What the button does, shown as its tooltip and read by screen readers. */
  label: string;
  /** A key that does the same, shown in the tooltip. */
  shortcut?: string;
  size?: "icon-xs" | "icon-sm" | "icon";
  children: ReactNode;
}

/** A button with only an icon, which says what it does in a tooltip. */
export function IconButton({ label, shortcut, size = "icon-sm", variant = "ghost", children, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} variant={variant} size={size} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <span className="ml-1.5 opacity-60">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
