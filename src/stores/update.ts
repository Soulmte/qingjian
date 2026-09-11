import type { Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";

interface UpdateState {
  /**
   * 已经下载完、等着安装的更新。
   *
   * 留在这里有两个用处：窗口被关闭时顺手装上（用户没说「现在就重启」，
   * 那就别擅自把窗口再拉起来），以及避免重复下载。
   */
  staged: Update | null;
  /** 正在安装：此后再有关闭请求就不要拦了。 */
  installing: boolean;
  stage: (update: Update) => void;
  beginInstall: () => void;
  clear: () => void;
}

export const useUpdate = create<UpdateState>((set) => ({
  staged: null,
  installing: false,
  stage: (update) => set({ staged: update }),
  beginInstall: () => set({ installing: true }),
  clear: () => set({ staged: null, installing: false }),
}));
