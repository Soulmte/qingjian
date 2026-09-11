import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";

import { SettingGroup, SettingRow, Toggle } from "@/components/settings/controls";
import { useSetting } from "@/components/settings/use-setting";
import { ReleaseNotes } from "@/components/update/ReleaseNotes";
import { useUpdateInstall } from "@/components/update/use-update-install";
import { errorMessage } from "@/lib/api";
import { checkForUpdates, formatBytes, formatReleaseTime, type Update } from "@/lib/update";

/** 与设置里其它警告文字同色。 */
const WARNING = "var(--qj-warning, #b45309)";

/**
 * 「更新」设置页。
 *
 * 面向的是**终端用户**，所以这里没有任何需要用户填写的字段，也不展示更新源这类
 * 内部信息（更新端点是构建期配置，见 `tauri.conf.json` 的 `plugins.updater`）。
 *
 * 更新走 Tauri 官方更新器：下载、验签、静默安装、自动重启，安装包不落到下载文件夹。
 */
export function UpdateSection() {
  const [autoCheck, setAutoCheck] = useSetting("autoCheckUpdate");
  const [lastCheck, setLastCheck] = useSetting("lastUpdateCheck");

  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState<Update | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const { phase, done, total, error, percent, download, installNow, reset } =
    useUpdateInstall(update);

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  const check = async () => {
    setBusy(true);
    setCheckError(null);
    setChecked(false);
    reset();
    try {
      const found = await checkForUpdates();
      setUpdate(found);
      setChecked(true);
      setLastCheck(new Date().toISOString());
    } catch (problem) {
      setUpdate(null);
      setCheckError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

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
            <button
              type="button"
              className="qj-text-btn"
              disabled={busy}
              onClick={() => void check()}
            >
              {busy ? "检查中…" : "检查更新"}
            </button>
            {checkError && (
              <span className="min-w-0 flex-1 text-xs break-words" style={{ color: WARNING }}>
                {checkError}
              </span>
            )}
            {checked && !checkError && (
              <span
                className="min-w-0 flex-1 text-xs"
                style={{ color: update ? "var(--qj-accent)" : undefined }}
              >
                {update ? `发现新版本 ${update.version}` : "已是最新版本"}
              </span>
            )}
          </div>
        </SettingRow>
      </SettingGroup>

      {update && (
        <section className="mb-5">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            新版本
          </h3>
          <div className="overflow-hidden rounded-xl border border-border/70 bg-surface">
            <div className="border-b border-border/50 px-3.5 py-2.5">
              <p className="text-sm font-medium">{`青简 ${update.version}`}</p>
              <p className="mt-0.5 text-xs text-muted">
                {`当前 ${update.currentVersion}`}
                {formatReleaseTime(update.date) && ` · 发布于 ${formatReleaseTime(update.date)}`}
              </p>
            </div>

            {update.body && (
              <div className="max-h-56 overflow-y-auto border-b border-border/50 px-3.5 py-2.5">
                <ReleaseNotes markdown={update.body} />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
              {(phase === "idle" || phase === "error") && (
                <>
                  <button
                    type="button"
                    className="qj-text-btn"
                    onClick={() => void download()}
                  >
                    下载并安装
                  </button>
                  <span className="text-[11px] text-muted">
                    下载后静默安装并自动重启，安装包不会留在「下载」文件夹
                  </span>
                </>
              )}

              {phase === "downloading" && (
                <span className="min-w-0 flex-1 text-xs text-muted">
                  {percent === null
                    ? `正在下载${total > 0 ? ` · ${formatBytes(done)} / ${formatBytes(total)}` : "…"}`
                    : `正在下载 ${percent}% · ${formatBytes(done)} / ${formatBytes(total)}`}
                </span>
              )}

              {phase === "staged" && (
                <>
                  <button type="button" className="qj-text-btn" onClick={() => void installNow()}>
                    立即重启并更新
                  </button>
                  <span className="text-[11px]" style={{ color: "var(--qj-accent)" }}>
                    已就绪；直接关掉青简也会自动装上
                  </span>
                </>
              )}

              {phase === "installing" && (
                <span className="text-xs" style={{ color: "var(--qj-accent)" }}>
                  正在安装，青简马上会自己重新打开…
                </span>
              )}

              {phase === "error" && error && (
                <span className="min-w-0 flex-1 text-xs break-words" style={{ color: WARNING }}>
                  {error}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      <p className="text-xs text-muted">
        青简从 GitHub Releases 取更新，安装前会校验签名——只有用发布者私钥签过名的包才会被装上。
      </p>
    </>
  );
}
