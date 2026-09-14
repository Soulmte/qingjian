import { useEffect, useState } from "react";

import {
  RangeField,
  SegmentedControl,
  SettingGroup,
  SettingRow,
  TextField,
  Toggle,
} from "@/components/settings/controls";
import { useSetting } from "@/components/settings/use-setting";
import { FolderPicker } from "@/components/ui/FolderPicker";
import { api, errorMessage } from "@/lib/api";
import type { GitProvider, ImageUploadMode } from "@/types";

/** Looks like `owner/repo`; the Rust side validates properly before sending. */
const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * Token field.
 *
 * The token is write-only: it goes into the `secret` table and no command ever
 * returns it, so this can only report whether one is stored.
 */
function GitTokenField({ provider }: { provider: GitProvider }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void api
      .gitTokenConfigured()
      .then(setConfigured)
      .catch(() => setConfigured(false));
  };

  useEffect(refresh, []);

  const save = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await api.setGitToken(draft.trim());
      setDraft("");
      setStatus("已保存");
      refresh();
    } catch (error) {
      setStatus(`保存失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await api.clearGitToken();
      setStatus("已清除");
      refresh();
    } catch (error) {
      setStatus(`清除失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="password"
          className="field w-52"
          aria-label="访问令牌"
          placeholder={configured ? "已配置（重新输入可覆盖）" : "粘贴访问令牌"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
        />
        <button
          type="button"
          className="qj-text-btn"
          disabled={busy || draft.trim().length === 0}
          onClick={() => void save()}
        >
          保存
        </button>
        <button
          type="button"
          className="qj-text-btn"
          disabled={busy || !configured}
          onClick={() => void clear()}
        >
          清除
        </button>
      </div>
      <p className="text-[11px] text-muted">
        {configured === null
          ? "正在读取…"
          : configured
            ? "已配置。令牌只存在本地数据库，请求由 Rust 发起，不会进入页面。"
            : "尚未配置。"}
        {status && <span className="ml-1">{status}</span>}
      </p>
      <p className="text-[11px] leading-relaxed text-muted">{TOKEN_HELP[provider]}</p>
    </div>
  );
}

/** Where each provider hands out a token, and what scope it has to carry. */
const TOKEN_HELP: Record<GitProvider, string> = {
  github:
    "GitHub → Settings → Developer settings → Personal access tokens（classic）。公开仓库勾选 public_repo，私有仓库勾选 repo。",
  gitee:
    "Gitee → 设置 → 私人令牌，勾选 projects 权限。注意 Gitee 的默认分支多为 master，请按仓库实际分支填写。",
};

/**
 * Dry run of the image-host configuration.
 *
 * Asking the provider for the target branch proves the token, the repository
 * and the branch at once, so a typo surfaces here rather than as an image that
 * silently failed to upload.
 */
function GitConnectionTest({
  provider,
  repo,
  branch,
}: {
  provider: GitProvider;
  repo: string;
  branch: string;
}) {
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult({ ok: true, text: await api.testGitConnection({ provider, repo, branch }) });
    } catch (error) {
      setResult({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="qj-text-btn"
          disabled={busy || repo.trim().length === 0}
          onClick={() => void run()}
        >
          {busy ? "检测中…" : "测试连接"}
        </button>
        {result && (
          <span
            className="min-w-0 text-xs"
            style={{ color: result.ok ? "var(--qj-accent)" : "var(--qj-warning, #b45309)" }}
          >
            {result.text}
          </span>
        )}
      </div>
    </div>
  );
}

export function ImageSection() {
  const [imageDir, setImageDir] = useSetting("imageDir");
  const [imageAutoInsert, setImageAutoInsert] = useSetting("imageAutoInsert");
  const [imageMaxWidth, setImageMaxWidth] = useSetting("imageMaxWidth");
  const [imageCompress, setImageCompress] = useSetting("imageCompress");
  const [imageMaxEdge, setImageMaxEdge] = useSetting("imageMaxEdge");
  const [imageQuality, setImageQuality] = useSetting("imageQuality");
  const [uploadMode, setUploadMode] = useSetting("imageUploadMode");
  const [provider, setProvider] = useSetting("gitProvider");
  const [repo, setRepo] = useSetting("gitRepo");
  const [branch, setBranch] = useSetting("gitBranch");
  const [gitDir, setGitDir] = useSetting("gitImageDir");
  const [repoPublic, setRepoPublic] = useSetting("gitRepoPublic");

  const repoLooksWrong = repo.trim().length > 0 && !REPO_PATTERN.test(repo.trim());
  const toGit = uploadMode === "git";

  return (
    <>
      <SettingGroup title="存放位置">
        <SettingRow
          label="模式"
          hint="本地路径可离线、可移植；图床给出公开地址，但依赖远端仓库"
        >
          <SegmentedControl<ImageUploadMode>
            ariaLabel="图片存放模式"
            value={uploadMode}
            onChange={setUploadMode}
            options={[
              { value: "local", label: "本地工作区" },
              { value: "git", label: "Git 图床" },
            ]}
          />
        </SettingRow>

        {!toGit && (
          <SettingRow
            label="图片文件夹"
            hint="相对工作区根目录；目录不存在时自动创建"
          >
            <FolderPicker
              ariaLabel="图片文件夹"
              value={imageDir}
              onChange={setImageDir}
              extra={["assets"]}
            />
          </SettingRow>
        )}

        {toGit && (
          <>
            <SettingRow label="平台" hint="Gitee 的接口与 GitHub 基本一致，认证方式不同">
              <SegmentedControl<GitProvider>
                ariaLabel="图床平台"
                value={provider}
                onChange={setProvider}
                options={[
                  { value: "github", label: "GitHub" },
                  { value: "gitee", label: "Gitee" },
                ]}
              />
            </SettingRow>

            <SettingRow
              label="仓库"
              hint={
                repoLooksWrong
                  ? "格式应为 owner/repo，例如 octocat/notes"
                  : "owner/repo，例如 octocat/notes"
              }
            >
              <TextField
                ariaLabel="图床仓库"
                value={repo}
                onChange={setRepo}
                placeholder="owner/repo"
              />
            </SettingRow>

            <SettingRow label="分支" hint="图片会提交到这个分支">
              <TextField
                ariaLabel="图床分支"
                value={branch}
                onChange={setBranch}
                placeholder="main"
              />
            </SettingRow>

            <SettingRow label="仓库内目录" hint="图片在仓库中的存放目录">
              <TextField
                ariaLabel="图床目录"
                value={gitDir}
                onChange={setGitDir}
                placeholder="assets"
              />
            </SettingRow>

            <SettingRow label="仓库可见性" hint="只影响提示；请求始终带令牌发送">
              <SegmentedControl<"public" | "private">
                ariaLabel="仓库可见性"
                value={repoPublic ? "public" : "private"}
                onChange={(value) => setRepoPublic(value === "public")}
                options={[
                  { value: "public", label: "公开" },
                  { value: "private", label: "私有" },
                ]}
              />
            </SettingRow>

            {!repoPublic && (
              <SettingRow
                label="私有仓库的提示"
                hint="raw 地址需要凭证才能访问，你自己能看到，但别人打不开这些图片"
              >
                <span className="text-xs text-warning">插图后仅本机可见</span>
              </SettingRow>
            )}

            <SettingRow label="访问令牌" stacked>
              <GitTokenField provider={provider} />
            </SettingRow>

            <SettingRow
              label="连接检测"
              hint="按当前平台、仓库、分支校验一次，确认令牌有读写权限"
              stacked
            >
              <GitConnectionTest provider={provider} repo={repo} branch={branch} />
            </SettingRow>
          </>
        )}
      </SettingGroup>

      <SettingGroup title="粘贴与拖入">
        <SettingRow label="自动插入引用" hint="写入后直接在光标处插入 Markdown 图片语法">
          <Toggle
            ariaLabel="自动插入引用"
            checked={imageAutoInsert}
            onChange={setImageAutoInsert}
          />
        </SettingRow>
        <SettingRow
          label="保存前压缩"
          hint="长边超过上限的缩小、生僻格式转成 JPEG；PNG 只缩尺寸，避免文字边上出现压缩噪声"
          stacked
        >
          {/* 开关与它管着的两个旋钮放在一行，关掉时下面两个就跟着失去意义。 */}
          <div className="flex flex-col gap-3">
            <Toggle
              ariaLabel="保存前压缩"
              checked={imageCompress}
              onChange={setImageCompress}
            />
            {imageCompress && (
              <>
                <SettingRow label="长边上限" hint="按比例缩到这么宽，不裁剪">
                  <RangeField
                    ariaLabel="长边上限"
                    value={imageMaxEdge}
                    min={640}
                    max={4000}
                    step={80}
                    onChange={setImageMaxEdge}
                    unit="px"
                  />
                </SettingRow>
                <SettingRow label="JPEG 质量" hint="只影响转成 JPEG 的图，PNG 用不到">
                  <RangeField
                    ariaLabel="JPEG 质量"
                    value={imageQuality}
                    min={40}
                    max={100}
                    step={1}
                    onChange={setImageQuality}
                    unit=""
                  />
                </SettingRow>
              </>
            )}
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="显示">
        <SettingRow label="最大宽度" hint="约束正文中图片的显示宽度，始终按比例缩放">
          <RangeField
            ariaLabel="图片最大宽度"
            value={imageMaxWidth}
            min={30}
            max={100}
            onChange={setImageMaxWidth}
            unit="%"
          />
        </SettingRow>
      </SettingGroup>
    </>
  );
}
