import { getVersion } from "@tauri-apps/api/app";

import { api } from "@/lib/api";
import { UPDATE_REPOSITORY } from "@/lib/project";
import type { UpdateInfo } from "@/types";

/**
 * 与 GitHub 比一次版本。
 *
 * 更新源（`UPDATE_REPOSITORY`）是构建期常量，见 `lib/project.ts`——终端用户
 * 不需要知道这一层，也不该被要求填写。
 *
 * 当前版本在这里现取，调用方不必先等 `getVersion()` 回来——否则很容易拿着
 * 一个空字符串去比大小，结论必然是错的。
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  return api.checkForUpdates({
    repository: UPDATE_REPOSITORY,
    currentVersion: await getVersion(),
    includePrerelease: false,
  });
}

/** 把 Release 的时间写成人能读的样子；解析不出来时返回 null。 */
export function formatReleaseTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}
