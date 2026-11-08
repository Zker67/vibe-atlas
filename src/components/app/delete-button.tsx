import { Flame, Trash2 } from "lucide-react";
import { PURGE_KEY, purgeHeld, usePurgeKey } from "@/lib/purge-key";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

/**
 * The delete button of the detail panels: to the trash, or, while Shift is
 * down, for good; the button turns red and its tooltip says so.
 */
export function DeleteButton({ onDelete }: { onDelete(purge: boolean): void }) {
  const purge = usePurgeKey();
  return (
    <IconButton
      label={purge ? "彻底删除，不进回收站" : `删除到回收站，按住 ${PURGE_KEY} 彻底删除`}
      shortcut={purge ? `${PURGE_KEY}+Delete` : "Delete"}
      className={cn(
        "transition-colors duration-150",
        purge ? "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive" : "hover:text-destructive",
      )}
      onClick={(e) => onDelete(purgeHeld(e))}
    >
      {purge ? (
        <Flame key="purge" className="animate-in duration-150 zoom-in-75 fade-in-0" />
      ) : (
        <Trash2 key="trash" className="animate-in duration-150 zoom-in-75 fade-in-0" />
      )}
    </IconButton>
  );
}
