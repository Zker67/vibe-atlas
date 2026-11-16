// What the data folder holds, in settings → 数据: its parts, what the
// cleanup can take back, and compacting the database (storage.go).

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Database, Eraser, History, LoaderCircle, Recycle } from "lucide-react";
import { toast } from "sonner";
import { Atlas, type StorageKind, type StorageUsage } from "@/mygo";
import { errorMessage, run } from "@/lib/api";
import { formatBytes } from "@/lib/bytes";
import { formatTime, useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SettingCard } from "./setting-card";

/** The parts, in the order they show: their names, what they count and their shade of one color. */
const PARTS: Record<StorageKind, { label: string; unit?: string; shade: string }> = {
  database: { label: "数据库", shade: "bg-primary" },
  images: { label: "图片", unit: "张", shade: "bg-primary/65" },
  files: { label: "附件", unit: "个", shade: "bg-primary/40" },
  wallpapers: { label: "背景图片", unit: "张", shade: "bg-primary/20" },
  other: { label: "其他", shade: "bg-muted-foreground/25" },
};

/** Compacting saves less than this: not worth it. */
const MIN_COMPACT = 64 << 10;

/** How long until ms, roughly: 「5 分钟」「1 小时 10 分钟」. */
function untilText(ms: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((ms - now) / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

export function StorageCard() {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [busy, setBusy] = useState<"" | "clean" | "compact">("");
  const now = useNow();

  const load = useCallback(async () => {
    const u = await run(Atlas.storageUsage());
    if (u) setUsage(u);
  }, []);
  useEffect(() => {
    let live = true;
    Atlas.storageUsage().then(
      (u) => live && setUsage(u),
      (e) => live && toast.error(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, []);

  const clean = async () => {
    setBusy("clean");
    const res = await run(Atlas.cleanStorage());
    setBusy("");
    if (res?.skipped) toast.error("读不到快速记录里还没保存的草稿，这次没有删除，稍后再试");
    else if (res && res.deleted > 0) toast.success(`清理了 ${res.deleted} 个文件，释放 ${formatBytes(res.freed)}`);
    else if (res) toast.success("没有到时间可以清理的文件");
    await load();
  };

  const compact = async () => {
    setBusy("compact");
    const saved = await run(Atlas.compactDatabase());
    setBusy("");
    if (saved !== undefined) toast.success(saved > 0 ? `数据库压缩了 ${formatBytes(saved)}` : "数据库已经是最紧凑的了");
    await load();
  };

  const grace = usage?.graceMinutes ?? 60;
  return (
    <SettingCard
      title="存储空间"
      description={`程序启动后和每小时自动清理一次没人用的图片和附件，刚不再使用的保留 ${grace >= 60 ? `${grace / 60} 小时` : `${grace} 分钟`}，方便撤销。备注、项目说明、图标和回收站里还在用的不会清理；原地引用的文件不在数据文件夹里，不会被动。`}
    >
      {usage ? <Usage usage={usage} /> : <UsageLoading />}

      <div className="flex flex-col divide-y divide-foreground/[0.06] rounded-md bg-muted/60">
        <Row icon={Recycle}>
          {!usage ? (
            <span className="h-4 w-40 animate-pulse rounded bg-muted" />
          ) : usage.reclaim.count === 0 ? (
            <span className="text-muted-foreground">没有可以回收的文件</span>
          ) : (
            <span className="flex flex-col gap-0.5">
              <span>
                {usage.reclaim.count} 个文件没人用了，共 {formatBytes(usage.reclaim.bytes)}
              </span>
              {usage.reclaim.readyCount < usage.reclaim.count && usage.reclaim.nextAt > 0 && (
                <span className="text-xs text-muted-foreground">
                  {usage.reclaim.count - usage.reclaim.readyCount} 个刚不再使用，约 {untilText(usage.reclaim.nextAt, now)}后可以清理
                </span>
              )}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto shrink-0"
            disabled={!usage || usage.reclaim.readyCount === 0 || busy !== ""}
            onClick={() => void clean()}
          >
            {busy === "clean" ? <LoaderCircle className="animate-spin" /> : <Eraser />}
            立即清理
          </Button>
        </Row>
        <Row icon={Database}>
          {!usage ? (
            <span className="h-4 w-32 animate-pulse rounded bg-muted" />
          ) : usage.databaseFree >= MIN_COMPACT ? (
            <span>数据库可以压缩约 {formatBytes(usage.databaseFree)}</span>
          ) : (
            <span className="text-muted-foreground">数据库不需要压缩</span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto shrink-0"
            disabled={!usage || usage.databaseFree < MIN_COMPACT || busy !== ""}
            onClick={() => void compact()}
          >
            {busy === "compact" ? <LoaderCircle className="animate-spin" /> : <Database />}
            压缩数据库
          </Button>
        </Row>
      </div>

      {usage && usage.lastClean.at > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <History className="size-3.5 shrink-0" />
          上次清理 {formatTime(usage.lastClean.at, now)}
          {usage.lastClean.skipped
            ? "，读不到快速记录的草稿，没有删除"
            : usage.lastClean.deleted > 0
              ? `，删掉 ${usage.lastClean.deleted} 个文件，释放 ${formatBytes(usage.lastClean.freed)}`
              : "，没有要删的"}
        </p>
      )}
    </SettingCard>
  );
}

function Row({ icon: Icon, children }: { icon: typeof Recycle; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-2.5 px-3 py-2 text-sm">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {children}
    </div>
  );
}

function Usage({ usage }: { usage: StorageUsage }) {
  const total = Math.max(usage.total, 1);
  return (
    <div className="flex flex-col gap-3" data-storage-total={usage.total}>
      <p className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{formatBytes(usage.total)}</span>
        <span className="text-xs text-muted-foreground">已用</span>
      </p>
      <div className="flex h-2 gap-px overflow-hidden rounded-full bg-muted" role="img" aria-label="各部分的占比">
        {usage.parts.map((p) =>
          p.bytes > 0 ? (
            <span
              key={p.kind}
              className={cn("h-full min-w-1 transition-[width] duration-500 ease-out", PARTS[p.kind].shade)}
              style={{ width: `${(p.bytes / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
        {usage.parts.map((p) => {
          const info = PARTS[p.kind];
          return (
            <li key={p.kind} className="flex min-w-0 items-center gap-2" data-storage-part={p.kind}>
              <span className={cn("size-2 shrink-0 rounded-full", info.shade)} />
              <span className="truncate">{info.label}</span>
              {info.unit && p.count > 0 && (
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {p.count} {info.unit}
                </span>
              )}
              <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{formatBytes(p.bytes)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Takes the room Usage takes, while it loads. */
function UsageLoading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="h-8 w-28 animate-pulse rounded bg-muted" />
      <span className="h-2 animate-pulse rounded-full bg-muted" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        {Object.keys(PARTS).map((k) => (
          <span key={k} className="h-4 animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}
