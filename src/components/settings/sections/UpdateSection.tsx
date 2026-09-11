import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";

import { SettingGroup, SettingRow, Toggle } from "@/components/settings/controls";
import { useSetting } from "@/components/settings/use-setting";
import { api, errorMessage } from "@/lib/api";
import { checkForUpdates, formatReleaseTime } from "@/lib/update";
import type { UpdateInfo } from "@/types";

/** 与设置里其它警告文字同色。 */
const WARNING = "var(--qj-warning, #b45309)";

/**
 * 「更新」设置页。
 *
 * 面向的是**终端用户**，所以这里没有任何需要用户填写的字段，也不展示更新源
 * 这类内部信息（那是构建期常量，见 `lib/project.ts`）。用户能做的只有「查」与
 * 「取」，以及决定要不要在启动时自动查。
 */
export function UpdateSection() {
  const [autoCheck, setAutoCheck] = useSetting("autoCheckUpdate");
  const [lastCheck, setLastCheck] = useSetting("lastUpdateCheck");

  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  const check = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setDownloadPath(null);
    setDownloadError(null);
    try {
      const info = await checkForUpdates();
      setResult(info);
      setLastCheck(new Date().toISOString());
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  const download = async (url: string, fileName: string) => {
    setDownloadBusy(true);
    setDownloadError(null);
    setDownloadPath(null);
    try {
      setDownloadPath(await api.downloadUpdate(url, fileName));
    } catch (problem) {
      setDownloadError(errorMessage(problem));
    } finally {
      setDownloadBusy(false);
    }
  };

  const releaseUrl = result?.releaseUrl ?? null;
  const assetUrl = result?.assetUrl ?? null;
  const assetName = result?.assetName ?? null;
  const published = formatReleaseTime(result?.publishedAt ?? null);

  return (
    <>
      <SettingGroup title="版本">
        <SettingRow label="当前版本">
          <span className="text-sm tabular-nums">{version || "读取中…"}</span>
        </SettingRow>
        <SettingRow label="上次检查">
          <span className="text-sm">{formatReleaseTime(lastCheck) ?? "尚未检查"}</span>
        </SettingRow>
        <SettingRow label="启动时自动检查" hint="每次启动查一次，有新版本时弹窗提示。">
          <Toggle checked={autoCheck} onChange={setAutoCheck} ariaLabel="启动时自动检查更新" />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="检查">
        <SettingRow label="检查更新" stacked>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="qj-text-btn" disabled={busy} onClick={() => void check()}>
              {busy ? "检查中…" : "检查更新"}
            </button>
            {error && (
              <span className="min-w-0 flex-1 text-xs break-words" style={{ color: WARNING }}>
                {error}
              </span>
            )}
            {result && !error && (
              <span
                className="min-w-0 flex-1 text-xs"
                style={{ color: result.updateAvailable ? "var(--qj-accent)" : undefined }}
              >
                {result.updateAvailable
                  ? `发现新版本 ${result.latestVersion}`
                  : `已是最新版本（${result.latestVersion}）`}
              </span>
            )}
          </div>
        </SettingRow>
      </SettingGroup>

      {result?.updateAvailable && (
        <section className="mb-5">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            新版本
          </h3>
          <div className="overflow-hidden rounded-xl border border-border/70 bg-surface">
            <div className="border-b border-border/50 px-3.5 py-2.5">
              <p className="text-sm font-medium">{result.title ?? result.latestVersion}</p>
              <p className="mt-0.5 text-xs text-muted">
                {`版本 ${result.latestVersion}`}
                {result.prerelease && " · 预发布"}
                {published && ` · ${published}`}
              </p>
            </div>

            {result.notes && (
              <div className="max-h-56 overflow-y-auto border-b border-border/50 px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap text-foreground/80">
                {result.notes}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
              {assetUrl && assetName ? (
                <>
                  <button
                    type="button"
                    className="qj-text-btn"
                    disabled={downloadBusy}
                    onClick={() => void download(assetUrl, assetName)}
                  >
                    {downloadBusy ? "下载中…" : "下载安装包"}
                  </button>
                  <span className="text-[11px] text-muted">
                    {`${assetName} · 存到系统「下载」文件夹，不覆盖同名文件`}
                  </span>
                </>
              ) : (
                <span className="text-[11px] text-muted">
                  这次发布没有附带本平台的安装包，请到发布页选取。
                </span>
              )}
              {releaseUrl && (
                <button
                  type="button"
                  className="qj-text-btn"
                  onClick={() => void api.openExternal(releaseUrl)}
                >
                  打开发布页
                </button>
              )}
            </div>

            {downloadPath && (
              <div className="flex items-center gap-2 border-t border-border/50 px-3.5 py-2.5">
                <span className="min-w-0 flex-1 truncate text-xs" title={downloadPath}>
                  {`已下载：${downloadPath}`}
                </span>
                <button
                  type="button"
                  className="qj-text-btn shrink-0"
                  onClick={() => void api.revealDownloaded(downloadPath)}
                >
                  在文件夹中显示
                </button>
              </div>
            )}

            {downloadError && (
              <p
                className="border-t border-border/50 px-3.5 py-2.5 text-xs"
                style={{ color: WARNING }}
              >
                {downloadError}
              </p>
            )}
          </div>
        </section>
      )}

      <p className="text-xs text-muted">
        青简不会在后台替换自己的程序文件。下载到新版本后，关掉应用再运行安装包即可。
      </p>
    </>
  );
}
