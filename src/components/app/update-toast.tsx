import { useEffect } from "react";
import { toast } from "sonner";
import { initUpdates, installUpdate, openReleases, updateLater, useUpdates } from "@/state/updates";

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
          closeButton: false,
          onDismiss: updateLater, // swiped away too
        });
        return;
      case "downloading":
        toast.loading(`正在更新到 ${v}`, {
          id: ID,
          className: CLASS,
          description: <DownloadProgress progress={update.progress} />,
          duration: Infinity,
          action: undefined,
          cancel: undefined,
          closeButton: false,
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
          closeButton: false,
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
          // To download the installer by hand; × puts it off, as 稍后 does.
          cancel: {
            label: "去 GitHub",
            onClick: () => {
              openReleases();
              updateLater();
            },
          },
          closeButton: true,
          onDismiss: updateLater, // closed or swiped away
        });
        return;
      default:
        toast.dismiss(ID);
    }
  }, [update, later]);

  return null;
}

/** How much of the update downloaded, 0 to 1: a bar that fills, and the percent beside it. */
function DownloadProgress({ progress }: { progress: number }) {
  const pct = Math.min(100, Math.max(0, Math.floor(progress * 100)));
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div
        role="progressbar"
        aria-label="下载进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-9 text-right text-xs tabular-nums">{pct}%</span>
    </div>
  );
}
