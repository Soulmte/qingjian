/**
 * 项目自身的地址。**只需要改这一处**：界面上的「开源地址」与检查更新用的仓库
 * 都由它派生。
 *
 * 这不是用户设置，而是构建期常量：终端用户不该被要求知道项目托管在哪、
 * 更不该被要求填写地址。
 */
export const PROJECT_OWNER = "lq";
export const PROJECT_NAME = "qingjian";

export const GITHUB_URL = `https://github.com/${PROJECT_OWNER}/${PROJECT_NAME}`;
export const GITEE_URL = `https://gitee.com/${PROJECT_OWNER}/${PROJECT_NAME}`;

/** 检查更新用的仓库，`owner/repo`，走 GitHub Releases。 */
export const UPDATE_REPOSITORY = `${PROJECT_OWNER}/${PROJECT_NAME}`;
