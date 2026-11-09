import { useEffect } from "react";
import { toast } from "sonner";
import { initUpdates, installUpdate, updateLater, useUpdates } from "@/state/updates";

const ID = "update";
/** The smoke test finds the toast by it. */
const CLASS = "update-toast";

/**
 * The toast of a newer version at the bottom right: 去更新 downloads it in
 * place, with its progress, and the app starts again in it; 稍后 puts it
 * off until the next launch. It shows no window of its own.
 */
export function UpdateToast() {
  const update = useUpdates((s) => s.update);
  const later = useUpdates((s) => s.later);

  useEffect(() => {
    void initUpdates();
  }, []);

  useEffect(() => {
    if (!update) return;
    const v = update.available;
    switch (update.phase) {
      case "checking":
        return; // what shows stays while it checks again
      case "available":
        if (v === later) {
          toast.dismiss(ID);
          return;
        }
        toast(`发现新版本 ${v}`, {
          id: ID,
          className: CLASS,
          description: `当前 ${update.version}，更新后自动重新打开`,
          duration: Infinity,
          action: {
            label: "去更新",
            onClick: (e) => {
              e.preventDefault(); // the toast stays, to show the progress
              installUpdate();
            },
          },
          cancel: { label: "稍后", onClick: updateLater },
          onDismiss: updateLater, // swiped away too
        });
        return;
      case "downloading":
        toast.loading(`正在更新到 ${v}`, {
          id: ID,
          className: CLASS,
          description: `已下载 ${Math.floor(update.progress * 100)}%`,
          duration: Infinity,
          action: undefined,
          cancel: undefined,
          onDismiss: undefined,
        });
        return;
      case "restarting":
        toast.loading("马上重新打开", {
          id: ID,
          className: CLASS,
          description: `已更新到 ${v}`,
          duration: Infinity,
          action: undefined,
          cancel: undefined,
          onDismiss: undefined,
        });
        return;
      case "failed":
        if (v === later) {
          toast.dismiss(ID);
          return;
        }
        toast.error("更新失败", {
          id: ID,
          className: CLASS,
          description: update.error,
          duration: Infinity,
          action: {
            label: "重试",
            onClick: (e) => {
              e.preventDefault();
              installUpdate();
            },
          },
          cancel: { label: "稍后", onClick: updateLater },
          onDismiss: updateLater, // swiped away too
        });
        return;
      default:
        toast.dismiss(ID);
    }
  }, [update, later]);

  return null;
}
