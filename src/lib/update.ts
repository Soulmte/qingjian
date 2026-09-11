import { check, type Update } from "@tauri-apps/plugin-updater";

export type { Update };

/**
 * 检查更新。
 *
 * 端点与公钥都在 `tauri.conf.json` 的 `plugins.updater` 里，用的是 Tauri 官方
 * 更新器：它算一次版本、下一份 `latest.json`，**并校验更新包的签名**——签名对不
 * 上就拒绝安装。这是这套机制里唯一不能省的一步：静默安装意味着我们会在用户不
 * 知情的情况下执行一个安装包，必须能确认它确实出自我们自己。
 *
 * 返回 `null` 表示当前已是最新版本。
 */
export function checkForUpdates(): Promise<Update | null> {
  return check();
}

/** 把 `latest.json` 里的时间写成人能读的样子；解析不出来时返回 null。 */
export function formatReleaseTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

/** 下载进度用的字节显示。 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
