import { getVersion } from "@tauri-apps/api/app";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { QingjianMark } from "@/components/ui/QingjianMark";
import { api } from "@/lib/api";
import { GITEE_URL, GITHUB_URL } from "@/lib/project";

const STACK: [string, string][] = [
  ["桌面壳", "Tauri 2"],
  ["前端", "React 19 · TypeScript · Vite"],
  ["组件与样式", "HeroUI v3 · Tailwind CSS v4"],
  ["编辑器内核", "Milkdown Crepe（ProseMirror）"],
  ["本地存储", "SQLite · sqlx"],
  ["全文检索", "FTS5（CJK 逐字索引）"],
];

export function AboutSection() {
  const [version, setVersion] = useState("—");

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  return (
    <>
      <div className="mb-6 flex items-center gap-4 rounded-xl border border-border/70 bg-surface p-5">
        <QingjianMark size={56} className="shrink-0" />
        <div className="min-w-0">
          <p className="text-base font-semibold">青简</p>
          <p className="text-xs text-muted">本地 Markdown 编辑器 · 版本 {version}</p>
        </div>
      </div>

      <section className="mb-6">
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
          技术构成
        </h3>
        <div className="overflow-hidden rounded-xl border border-border/70 bg-surface">
          {STACK.map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4 border-b border-border/50 px-4 py-2.5 last:border-b-0"
            >
              <span className="text-sm text-muted">{label}</span>
              <span className="text-right text-sm">{value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
          开源地址
        </h3>
        <div className="overflow-hidden rounded-xl border border-border/70 bg-surface">
          {[
            ["GitHub", GITHUB_URL],
            ["Gitee", GITEE_URL],
          ].map(([label, url]) => (
            <button
              key={label}
              type="button"
              onClick={() => void api.openExternal(url)}
              className="flex w-full cursor-pointer items-center justify-between gap-4 border-b border-border/50 px-4 py-2.5 text-left last:border-b-0 hover:bg-default/60"
            >
              <span className="text-sm text-muted">{label}</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm">{url.replace("https://", "")}</span>
                <ExternalLink className="size-3.5 shrink-0 opacity-60" />
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          青简是开源软件。发现问题或想要什么功能，欢迎到上面的仓库提 issue。
        </p>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
          数据说明
        </h3>
        <div className="rounded-xl border border-border/70 bg-surface p-4 text-sm leading-relaxed text-foreground/80">
          <p>
            笔记正文始终以 Markdown 文件保存在你选择的工作区目录里，SQLite
            只记录元数据、标签、版本快照与搜索索引。即使删除应用，文件仍然可以被任何编辑器打开。
          </p>
        </div>
      </section>

      <p className="text-xs text-muted">
        按 Ctrl + , 可随时回到设置；编辑区按 Esc 关闭设置。
      </p>
    </>
  );
}
