import { useState } from "react";

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
 */
export function useUpdateInstall(update: Update | null) {
  const [phase, setPhase] = useState<InstallPhase>("idle");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const stage = useUpdate((state) => state.stage);
  const beginInstall = useUpdate((state) => state.beginInstall);

  const download = async () => {
    if (!update) return;
    setPhase("downloading");
    setError(null);
    setDone(0);
    setTotal(0);
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          setTotal(event.data.contentLength ?? 0);
        } else if (event.event === "Progress") {
          setDone((current) => current + event.data.chunkLength);
        }
      });
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
    setError(null);
  };

  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;

  return { phase, done, total, error, percent, download, installNow, reset };
}
