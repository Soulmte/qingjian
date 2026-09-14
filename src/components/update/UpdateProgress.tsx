import { cn } from "@/lib/cn";
import { formatBytes, formatRemaining, formatSpeed } from "@/lib/update";

/**
 * 下载进度条，弹窗与设置页共用一份。
 *
 * 两件事是刻意的：
 * - **总大小不知道时用不定态。** 服务器走分块传输就没有 `content-length`，这时
 *   任何百分比都是编的；与其画一根停在某处的条，不如让它走起来，同时把已收到的
 *   字节数说清楚。
 * - **完成时归位到 100%。** `contentLength` 与实际收到的字节数可能对不齐（重定向、
 *   压缩），按字节算出来的百分比收尾时可能停在 96%——下载确实完成了，条就该满。
 */
export function UpdateProgress({
  done,
  total,
  speed,
  percent,
  className,
}: {
  done: number;
  total: number;
  /** 字节/秒，拿不到时为 null。 */
  speed: number | null;
  /** 0–100；null 表示总大小未知。 */
  percent: number | null;
  className?: string;
}) {
  const known = percent !== null;
  const remaining = known && speed !== null ? formatRemaining(total - done, speed) : null;

  return (
    <div className={cn("mt-3", className)}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-default">
        <div
          className={cn(
            "h-full rounded-full bg-[var(--qj-accent)]",
            known ? "transition-[width] duration-200" : "qj-update-sweep w-1/3",
          )}
          style={known ? { width: `${percent}%` } : undefined}
        />
      </div>

      <p className="mt-1.5 text-xs text-muted tabular-nums">
        {known
          ? `正在下载 ${percent}% · ${formatBytes(done)} / ${formatBytes(total)}`
          : `正在下载 · 已收到 ${formatBytes(done)}`}
        {speed !== null && ` · ${formatSpeed(speed)}`}
        {remaining !== null && ` · ${remaining}`}
      </p>
    </div>
  );
}
