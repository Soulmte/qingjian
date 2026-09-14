# 提交与发布

青简自己的约定：日常改代码看第一节，发版看第二节，踩过的坑在第三节。

## 一、日常提交

1. 改完先跑一遍，过了再提交：

   ```bash
   npm run typecheck
   npx vitest run
   cd src-tauri && cargo test
   ```

   动了界面的再 `npm run build` 一次，确认产物出得来。

2. 提交前先 `git status` 看清列表。**临时诊断脚本不要提交**（`_watch_ci.py` 这类），用 `git add -A` 时尤其容易顺手带进去。

3. 提交信息用中文，一行说清做了什么，别写「update」「fix bug」：

   ```
   只扫描笔记并优化大文档的打开与输入
   ```

   需要展开的写正文，与标题空一行。

4. 推上 main 即可，不需要开分支：

   ```bash
   git push origin main
   ```

## 二、发布新版本

1. **版本号要改三处**，漏一处会出现「应用内版本」和「安装包版本」对不上：

   * `package.json` → `version`
   * `src-tauri/tauri.conf.json` → `version`
   * `src-tauri/Cargo.toml` → `version`

   lock 文件不用手改：`npm install --package-lock-only` 与下一次 `cargo test` 会自动同步。

2. 写 `release-notes.md`。它一份两用：既是 GitHub Release 的说明，也会被 CI 塞进 `latest.json` 的 `notes`，成为应用内更新弹窗里那段文字——所以**写给用户看**，别写开发细节。

3. 提交、推 main、打 tag：

   ```bash
   git add <改动的文件>
   git commit -m "…"
   git push origin main
   git tag -a v0.1.6 -m "青简 v0.1.6"
   git push origin v0.1.6
   ```

4. tag 一推，`.github/workflows/release.yml` 自动跑：`npm ci` → 前端测试 → 类型检查 → `cargo test` → 签名构建 → 把产物改成 ASCII 名 → 生成 `latest.json` → `gh release`。

5. 发完确认三件事：

   * Release 里有 `Qingjian_<版本>_x64-setup.exe`、`.exe.sig`、`latest.json`；
   * `https://github.com/Soulmte/qingjian/releases/latest/download/latest.json` 的 `version` 是新版本，`url` 指向 `..._x64-setup.exe`；
   * 装上旧版能收到更新提示。

### 签名密钥（只配一次）

自动更新靠一对 minisign 密钥：**私钥签名、公钥验签**。

* 私钥在 `~/.tauri/qingjian-updater.key`，**在仓库外，绝不提交**；公钥写在 `tauri.conf.json` 的 `plugins.updater.pubkey`。
* GitHub 仓库 Settings → Secrets and variables → Actions 里放两个 secret：
  * `TAURI_SIGNING_PRIVATE_KEY`：私钥文件的**全部内容**
  * `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：留空（生成时没设密码）
* **私钥务必另外备份。** 丢了就再也发不出老用户能装上的更新，只能让所有人手动重装并换新密钥。

## 三、注意点（都是踩过的）

* **`tauri.conf.json` 和 `capabilities/*.json` 是严格 JSON，不能写 `//` 注释**，否则构建直接报 `key must be a string`。要解释就写在 README、工作流或这份文件里。

* **安装包附件名必须全 ASCII。** GitHub 保存附件名时会丢掉非 ASCII 字符，`青简_0.1.6_x64-setup.exe` 会变成 `_0.1.6_x64-setup.exe`。工作流把产物改名成 `Qingjian_<版本>_x64-setup.exe`，`latest.json` 里的地址也必须指向改名后的文件，否则更新器会下到 404。

* **Tauri 2.x 直接给 `.exe` 本体签名**（产出 `<name>.exe.sig`），不再有 `.nsis.zip`。工作流两种格式都兼容，但改动时别只按老格式写。

* **本地 `tauri build` 前先关掉正在运行的青简**，否则会报 `failed to remove file ... os error 5`：

  ```bash
  taskkill //IM qingjian.exe //F
  ```

* **迁移文件（`src-tauri/migrations/*.sql`）一旦应用过就不能再改。** sqlx 对它们做 SHA-384 校验，改一个字节就拒绝启动；要改结构请新加一个编号更大的迁移文件。`.gitattributes` 已用 `-text` 钉死它们的行尾，别动。

* **加了新的窗口/系统 API 调用，记得同步加权限。** Tauri 把前端能调的 core API 关在 `capabilities/default.json` 里，漏一条往往表现为「点了没反应」而不是报错——v0.1.4 那个关不掉的窗口，就是漏了 `core:window:allow-destroy`。

* **MSI 的代码页必须是 936**：WiX 默认的 1252 装不下「青简」两个字，`tauri.conf.json` 里已指定 `zh-CN`，别改回去。

* **改完自动更新相关的东西，至少本地跑一次真实验证**（装个正式版、让它更新一次）。开发模式下更新器的行为和正式版不同，光看代码不算数。

* **Gitee 只能手动发**，更新端点仍指向 GitHub，Gitee 只作镜像。注意它的账号名与 GitHub 不同（GitHub 是 `Soulmte`，Gitee 是 `rain-drops`）：

  ```bash
  python scripts/publish.py gitee --repo rain-drops/qingjian --tag v0.1.8 \
    --notes-file release-notes.md --create-repo \
    --asset "本地路径=ASCII 发布名"
  ```

  两点都是踩出来的：

  * **首次发布要先把代码和 tag 推上去。** Gitee 建 Release 时要给 tag 找一个 commit，空仓库没有，会报 `创建标签失败：v0.1.8`。先 `git push <gitee 地址> main v0.1.8`，再跑上面的命令。
  * **建仓时那句 `private=false` 不一定会被采纳。** v0.1.8 那次建出来就是私有仓库，而脚本照样打印了「已创建公开仓库」——私有的镜像等于没有，用户点进去只有登录页。脚本现在建完会自己确认一遍并改回来，改不动就直接停下来报错（那种情况多半是账号没过实名认证）。

