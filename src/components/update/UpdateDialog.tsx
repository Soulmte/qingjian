import { Button, Modal } from "@heroui/react";

import { ReleaseNotes } from "@/components/update/ReleaseNotes";
import { useUpdateInstall } from "@/components/update/use-update-install";
import { api } from "@/lib/api";
import { GITHUB_URL } from "@/lib/project";
import { formatBytes, formatReleaseTime, type Update } from "@/lib/update";

const WARNING = "var(--qj-warning, #b45309)";

/**
 * 查到新版本时弹出来。
 *
 * 走的是 Tauri 官方更新器：**下载、验签、静默安装、自动重启**一条龙。安装包落在
 * 系统临时目录里、装完由系统回收，不会留在「下载」文件夹，也不需要用户再去点一次
 * 安装向导。装之前会先把当前笔记存盘。
 */
export function UpdateDialog({
  isOpen,
  onOpenChange,
  update,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  update: Update;
}) {
  const { phase, done, total, error, percent, download, installNow } = useUpdateInstall(update);

  const published = formatReleaseTime(update.date);
  const busy = phase === "downloading" || phase === "installing";

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="lg">
        <Modal.Dialog aria-label="发现新版本">
          <Modal.Header>
            <Modal.Heading>{`发现新版本 ${update.version}`}</Modal.Heading>
          </Modal.Header>

          <Modal.Body>
            <p className="text-sm text-muted">
              {`当前版本 ${update.currentVersion}，可以升级到 ${update.version}`}
              {published && ` · 发布于 ${published}`}
            </p>

            {update.body && (
              <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border/70 bg-surface p-3">
                <ReleaseNotes markdown={update.body} />
              </div>
            )}

            {phase === "idle" && (
              <p className="mt-3 text-xs text-muted">
                更新全程无需操作：青简会自己下载、静默安装并重新打开，安装包不会留在「下载」文件夹。
              </p>
            )}

            {phase === "downloading" && (
              <div className="mt-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-default">
                  <div
                    className="h-full rounded-full transition-all duration-200"
                    style={{
                      width: percent === null ? "30%" : `${percent}%`,
                      background: "var(--qj-accent)",
                    }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  {percent === null
                    ? `正在下载${total > 0 ? ` · ${formatBytes(done)} / ${formatBytes(total)}` : "…"}`
                    : `正在下载 ${percent}% · ${formatBytes(done)} / ${formatBytes(total)}`}
                </p>
              </div>
            )}

            {phase === "staged" && (
              <p className="mt-3 text-xs" style={{ color: "var(--qj-accent)" }}>
                安装包已就绪。点「立即重启并更新」马上完成；直接关掉青简也会自动装上。
              </p>
            )}

            {phase === "installing" && (
              <p className="mt-3 text-xs" style={{ color: "var(--qj-accent)" }}>
                正在安装，青简马上会自己重新打开…
              </p>
            )}

            {phase === "error" && error && (
              <p className="mt-3 text-xs break-words" style={{ color: WARNING }}>
                {error}
              </p>
            )}
          </Modal.Body>

          <Modal.Footer className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              onPress={() => void api.openExternal(`${GITHUB_URL}/releases/tag/v${update.version}`)}
            >
              打开发布页
            </Button>
            <Button variant="ghost" isDisabled={busy} onPress={() => onOpenChange(false)}>
              {phase === "staged" ? "稍后（关闭时自动安装）" : "稍后再说"}
            </Button>
            {phase === "idle" && <Button onPress={() => void download()}>立即更新</Button>}
            {phase === "downloading" && <Button isDisabled>下载中…</Button>}
            {phase === "staged" && <Button onPress={() => void installNow()}>立即重启并更新</Button>}
            {phase === "installing" && <Button isDisabled>安装中…</Button>}
            {phase === "error" && <Button onPress={() => void download()}>重试</Button>}
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
