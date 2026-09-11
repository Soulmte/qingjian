import { Button, Modal } from "@heroui/react";
import { useState } from "react";

import { api, errorMessage } from "@/lib/api";
import { formatReleaseTime } from "@/lib/update";
import type { UpdateInfo } from "@/types";

/** 与设置里其它警告文字同色。 */
const WARNING = "var(--qj-warning, #b45309)";

/**
 * 查到新版本时弹出来。
 *
 * 只做「告知 + 取件」：把安装包下到系统下载目录，或者把人送到发布页。
 * 不在后台替换自己的程序文件——那需要一套签名密钥与 `latest.json`，见
 * `src-tauri/src/commands/update.rs` 顶部的说明。
 */
export function UpdateDialog({
  isOpen,
  onOpenChange,
  info,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  info: UpdateInfo;
}) {
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const published = formatReleaseTime(info.publishedAt);
  const canDownload = Boolean(info.assetUrl && info.assetName);

  const download = async () => {
    if (!info.assetUrl || !info.assetName) return;
    setBusy(true);
    setError(null);
    try {
      setPath(await api.downloadUpdate(info.assetUrl, info.assetName));
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="lg">
        <Modal.Dialog aria-label="发现新版本">
          <Modal.Header>
            <Modal.Heading>{`发现新版本 ${info.latestVersion}`}</Modal.Heading>
          </Modal.Header>

          <Modal.Body>
            <p className="text-sm text-muted">
              {`当前版本 ${info.currentVersion}，可以升级到 ${info.latestVersion}`}
              {info.prerelease && "（预发布版）"}
              {published && ` · 发布于 ${published}`}
            </p>

            {info.notes && (
              <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border/70 bg-surface p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground/80">
                {info.notes}
              </div>
            )}

            {path ? (
              <div className="mt-3 rounded-lg border border-border/70 bg-surface p-3">
                <p className="text-xs text-muted">安装包已下载到：</p>
                <p className="mt-1 text-xs break-all">{path}</p>
                <Button
                  className="mt-2"
                  variant="outline"
                  onPress={() => void api.revealDownloaded(path)}
                >
                  在文件夹中显示
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted">
                关闭青简后再运行安装包即可完成升级。你的工作区文件不会被改动。
              </p>
            )}

            {error && (
              <p className="mt-3 text-xs" style={{ color: WARNING }}>
                {error}
              </p>
            )}
          </Modal.Body>

          <Modal.Footer className="flex flex-wrap justify-end gap-2">
            {info.releaseUrl && (
              <Button
                variant="ghost"
                onPress={() => void api.openExternal(info.releaseUrl as string)}
              >
                打开发布页
              </Button>
            )}
            <Button variant="ghost" onPress={() => onOpenChange(false)}>
              {path ? "关闭" : "稍后再说"}
            </Button>
            {canDownload && !path && (
              <Button isDisabled={busy} onPress={() => void download()}>
                {busy ? "下载中…" : "立即更新"}
              </Button>
            )}
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
