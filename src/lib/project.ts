/**
 * 项目自身的地址。**只需要改这一处**：界面上的「开源地址」与检查更新用的仓库
 * 都由它派生。
 *
 * 这不是用户设置，而是构建期常量：终端用户不该被要求知道项目托管在哪、
 * 更不该被要求填写地址。
 */
export const PROJECT_OWNER = "Soulmte";
export const PROJECT_NAME = "qingjian";

/**
 * Gitee 镜像所在账号。
 *
 * 两侧账号名并不相同：GitHub 是 `Soulmte`，Gitee 是 `rain-drops`。
 *
 * Gitee 不只是备用：**自动更新先问它**（端点列表在 `tauri.conf.json` 的
 * `plugins.updater` 里，Gitee 那条排在前），问不到才退到 GitHub。
 */
export const GITEE_OWNER = "rain-drops";

export const GITHUB_URL = `https://github.com/${PROJECT_OWNER}/${PROJECT_NAME}`;
export const GITEE_URL = `https://gitee.com/${GITEE_OWNER}/${PROJECT_NAME}`;

/** 发布与更新用的主仓库，`owner/repo`。端点列表里 GitHub 是备选那一条。 */
export const UPDATE_REPOSITORY = `${PROJECT_OWNER}/${PROJECT_NAME}`;

/**
 * 某个版本的发布页。
 *
 * 只在自动更新两次都失败时作为手动出路给出：同一份安装包，双击装上即可。
 */
export function mirrorReleaseUrl(version: string): string {
  return `${GITEE_URL}/releases/tag/v${version}`;
}
