// The right-click menu of a note's picture, on its card and in the large
// view: 查看大图, 复制图片, 用默认应用打开, 打开文件夹位置, 删除图片.

import { Copy, ExternalLink, FolderOpen, Maximize2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { run, runOk } from "@/lib/api";
import { type MenuEntries, showPageMenu } from "@/lib/page-menu";
import { Atlas } from "@/mygo";

interface PictureMenu {
  /** The file is gone: only removing it from the note is left. */
  missing?: boolean;
  /** Opens the large view, where the card shows. */
  view?: () => void;
  /** Takes the picture out of the note, where the card shows. */
  remove?: () => void;
  restore?: () => void;
}

/**
 * Shows the menu of the picture name for the right-click e, and keeps the
 * system's from showing. Where the page has no menu (quick capture), the
 * system's shows, with the picture's entries of app.go.
 */
export function showPictureMenu(e: MouseEvent, name: string, opts: PictureMenu) {
  const entries: MenuEntries = [];
  if (!opts.missing) {
    if (opts.view) entries.push({ label: "查看大图", icon: Maximize2, run: opts.view }, null);
    entries.push(
      {
        label: "复制图片",
        icon: Copy,
        run: () => void runOk(Atlas.copyImage(name)).then((ok) => ok && toast.success("已复制图片")),
      },
      { label: "用默认应用打开", icon: ExternalLink, run: () => void run(Atlas.openImage(name)) },
      { label: "打开文件夹位置", icon: FolderOpen, run: () => void run(Atlas.showImageInFolder(name)) },
    );
  }
  if (opts.remove) {
    if (entries.length > 0) entries.push(null);
    entries.push({ label: "删除图片", icon: Trash2, destructive: true, run: opts.remove });
  }
  if (entries.length === 0) return;
  if (showPageMenu({ x: e.clientX, y: e.clientY, entries, restore: opts.restore })) {
    e.preventDefault();
    e.stopPropagation();
  }
}
