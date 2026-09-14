import { check, type Update } from "@tauri-apps/plugin-updater";

import { formatBytes } from "@/lib/bytes";

// 这个模块原先自己放着一份，图片压缩也要用同一个说法，所以搬到了 lib/bytes。
// 这里转出去，免得改动一行就要去动引用它的一串地方。
export { formatBytes };
export type { Update };

/**
 * 检查更新。
 *
 * 端点与公钥都在 `tauri.conf.json` 的 `plugins.updater` 里，用的是 Tauri 官方
 * 更新器：它算一次版本、下一份 `latest.json`，**并校验更新包的签名**——签名对不
 * 上就拒绝安装。这是这套机制里唯一不能省的一步：静默安装意味着我们会在用户不
 * 知情的情况下执行一个安装包，必须能确认它确实出自我们自己。
 *
 * `proxy` 由「设置 → 更新」给出。Tauri 把它记在这次检查拿到的 Update 对象上，
 * 后续 `download()` 也走它——这是运行时唯一能改变下载路径的入口。代理只能拖慢或
 * 加快传输，改不了包，因为验签用的是仓库外的那把公钥。
 *
 * 返回 `null` 表示当前已是最新版本。
 */
export function checkForUpdates(proxy?: string): Promise<Update | null> {
  const trimmed = proxy?.trim();
  return check(trimmed ? { proxy: trimmed } : undefined);
}

/** 把 `latest.json` 里的时间写成人能读的样子；解析不出来时返回 null。 */
export function formatReleaseTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

/** 下载速度，形如 `1.4 MB/s`。 */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * 大约还要多久，形如 `约剩 12 秒`；算不出来时返回 null。
 *
 * 只在剩余量还大于 1 秒时才报，否则最后几个字节会让读数跳来跳去。
 */
export function formatRemaining(bytesLeft: number, bytesPerSecond: number): string | null {
  if (bytesPerSecond <= 0 || bytesLeft <= 0) return null;
  const seconds = Math.round(bytesLeft / bytesPerSecond);
  if (seconds < 1) return null;
  if (seconds < 60) return `约剩 ${seconds} 秒`;
  return `约剩 ${Math.round(seconds / 60)} 分钟`;
}
