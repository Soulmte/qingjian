import { useRef, useState } from "react";

import type { Update } from "@/lib/update";
import { useUpdate } from "@/stores/update";
import { useWorkspace } from "@/stores/workspace";

/** 装更新这件事分几段，每段的按钮与文案都不一样。 */
export type InstallPhase = "idle" | "downloading" | "staged" | "installing" | "error";

/**
 * 「下载 → 暂存 → 安装」这套流程，弹窗与设置页共用。
 *
 * 先下载再安装（而不是一步 `downloadAndInstall`）是为了让用户能选时机：
 * 下载完可以立刻重启装，也可以直接关掉窗口，由 `App` 的关闭处理顺手装上。
 *
 * 进度是**按收到的字节数**算的，不是猜的：`Started` 给总大小，`Progress` 给每块
 * 的长度，两者都来自更新器。总大小缺失时（服务端用了分块传输）不假装知道进度，
 * 改为不定态、只报已收到的量——原来那种「不知道总大小就画 30%」的写法，看起来
 * 像个进度条，其实什么也没说。
 */
export function useUpdateInstall(update: Update | null) {
  const [phase, setPhase] = useState<InstallPhase>("idle");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [speed, setSpeed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * 下完了，但字节统计可能还没跑满（服务端给的 contentLength 与实际收到的量
   * 不一定完全一致）。这一条让进度条在完成时归位到 100%，而不是卡在 96%。
   */
  const [finished, setFinished] = useState(false);

  const stage = useUpdate((state) => state.stage);
  const beginInstall = useUpdate((state) => state.beginInstall);

  /** 第一块数据的到达时刻：连接与 TLS 握手不算下载耗时。 */
  const firstChunkAt = useRef<number | null>(null);

  const download = async () => {
    if (!update) return;
    setPhase("downloading");
    setError(null);
    setDone(0);
    setTotal(0);
    setSpeed(null);
    setFinished(false);
    firstChunkAt.current = null;

    try {
      await update.download((event) => {
        if (event.event === "Started") {
          setTotal(event.data.contentLength ?? 0);
          return;
        }
        if (event.event !== "Progress") return;

        const now = performance.now();
        firstChunkAt.current ??= now;
        setDone((current) => {
          const next = current + event.data.chunkLength;
          const seconds = (now - firstChunkAt.current!) / 1000;
          // 太短的窗口算出来的速度没有意义，宁可先不报。
          if (seconds > 0.5) setSpeed(next / seconds);
          return next;
        });
      });

      setFinished(true);
      stage(update);
      setPhase("staged");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
      setPhase("error");
    }
  };

  /**
   * 立即安装并重启。
   *
   * Windows 上 `install` 会启动安装程序紧接着结束本进程，所以这之后的代码
   * 不一定跑得到——界面要先把状态摆好。
   */
  const installNow = async () => {
    if (!update) return;
    setPhase("installing");
    beginInstall();
    try {
      // 这次是真的要重启，未保存的内容不能跟着一起没
      await useWorkspace.getState().flushSave();
      await update.install({ restartAfterInstall: true });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
      setPhase("error");
    }
  };

  const reset = () => {
    setPhase("idle");
    setDone(0);
    setTotal(0);
    setSpeed(null);
    setFinished(false);
    setError(null);
    firstChunkAt.current = null;
  };

  const percent =
    finished || (total > 0 && done >= total)
      ? 100
      : total > 0
        ? Math.min(99, Math.round((done / total) * 100))
        : null;

  return { phase, done, total, speed, error, percent, download, installNow, reset };
}
