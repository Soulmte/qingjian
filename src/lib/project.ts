/**
 * 项目自身的地址。**只需要改这一处**：界面上的「开源地址」与检查更新用的仓库
 * 都由它派生。
 *
 * 这不是用户设置，而是构建期常量：终端用户不该被要求知道项目托管在哪、
 * 更不该被要求填写地址。
 */
export const PROJECT_OWNER = "Soulmte";
export const PROJECT_NAME = "qingjian";

export const GITHUB_URL = `https://github.com/${PROJECT_OWNER}/${PROJECT_NAME}`;
export const GITEE_URL = `https://gitee.com/${PROJECT_OWNER}/${PROJECT_NAME}`;

/** 检查更新用的仓库，`owner/repo`，走 GitHub Releases。 */
export const UPDATE_REPOSITORY = `${PROJECT_OWNER}/${PROJECT_NAME}`;

/**
 * 某个版本在镜像（Gitee）上的发布页。
 *
 * 只在「下载太慢」时作为手动出路给出：GitHub 的安装包在国内经常只有几十 KB/s，
 * 而镜像那边是同一份包，下下来双击安装即可。自动更新仍然只走 GitHub——Tauri 的
 * 更新端点是构建期配置，运行时改不了，强行改写要自己重做一遍验签，不值得。
 */
export function mirrorReleaseUrl(version: string): string {
  return `${GITEE_URL}/releases/tag/v${version}`;
}
