/** Mirrors the Rust models in `src-tauri/src/models.rs`. */

export interface Workspace {
  id: number;
  name: string;
  rootPath: string;
  createdAt: number;
  lastOpenedAt: number | null;
}

export interface Note {
  id: number;
  workspaceId: number;
  relPath: string;
  title: string;
  contentHash: string | null;
  pinned: boolean;
  isDeleted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface NoteDetail {
  note: Note;
  content: string;
  /**
   * Hash of the content just read. Kept as the baseline for the next save so a
   * file changed on disk in the meantime can be told apart from one that was
   * not — see `SaveOutcome`.
   */
  hash: string;
}

/** What a save did. A conflict means nothing was written. */
export type SaveOutcome =
  | { status: "saved"; note: Note; hash: string }
  | { status: "conflict"; diskHash: string };

export interface SearchHit {
  noteId: number;
  workspaceId: number;
  title: string;
  relPath: string;
  snippet: string;
}

/**
 * 一条历史版本，**不带正文**。
 *
 * 列表一次可能有几十条，每条都带着整篇正文就只是为了显示几个时间戳——一篇长
 * 笔记的列表会是几兆数据。要看内容再单独取那一条。
 */
export interface NoteRevision {
  id: number;
  noteId: number;
  /** Unix 秒。 */
  createdAt: number;
  /** 字符数，用来分辨「改了一行」和「整篇重写」。 */
  size: number;
  /** 正文里第一行非空文字（去过 Markdown 标记、截断过）。 */
  preview: string;
}

export interface NoteRevisionDetail {
  revision: NoteRevision;
  content: string;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export type ThemeMode = "light" | "dark" | "system";

/** 强调色，对应 `theme.css` 里的 `[data-qj-accent]` */
export type AccentName =
  | "bamboo"
  | "ink"
  | "rouge"
  | "ochre"
  | "violet"
  | "teal"
  | "mono"
  | "gamboge"
  | "idea";

/** 代码块背景，对应 `[data-qj-codebg]`。cloud/sand/celadon 为亮色，其余为暗色。 */
export type CodeBackgroundName =
  | "cloud"
  | "sand"
  | "celadon"
  | "graphite"
  | "jade"
  | "space";

/** 图片存放位置：本地工作区，还是 Git 图床。 */
export type ImageUploadMode = "local" | "git";

/** 图床平台。两家的 Contents API 只在认证位置和 raw 地址上不同。 */
export type GitProvider = "github" | "gitee";

/** 导出格式。`md` 直接写 Markdown，`pdf` 走 webview 打印链路，其余由 Rust 渲染。 */
export type ExportFormat = "docx" | "html" | "txt" | "md" | "pdf";

/** 导出纸张，尺寸在 Rust 侧换算。 */
export type ExportPageSize = "a4" | "letter";

/** 本机安装的一个字体族，由 Rust 侧的 fontdb 扫描得到。 */
export interface SystemFont {
  family: string;
  /** 等宽字体，用于过滤代码字体候选。 */
  monospace: boolean;
}

export interface AppSettings {
  /* 外观 */
  theme: ThemeMode;
  accent: AccentName;
  /** 界面字体族名；空串表示使用内置字体栈。 */
  uiFont: string;
  /** 圆角半径，px */
  radius: number;
  /** 界面缩放倍数，作用于整个 webview。 */
  zoom: number;

  /* 编辑器 */
  fontSize: number;
  lineHeight: number;
  editorWidth: number;
  /** 正文字体族名；空串表示跟随界面字体。 */
  editorFont: string;
  spellCheck: boolean;
  /** 专注模式：只高亮当前段落，其余淡化。 */
  focusMode: boolean;
  /** 打字机模式：光标所在行始终位于视口中央。 */
  typewriterMode: boolean;

  /* 代码 */
  codeBackground: CodeBackgroundName;
  /** 代码字体族名；空串表示使用内置等宽栈。 */
  codeFont: string;
  codeFontSize: number;

  /* Markdown */
  mathEnabled: boolean;
  tableEnabled: boolean;
  codeHighlightEnabled: boolean;
  linkTooltipEnabled: boolean;
  blockHandleEnabled: boolean;

  /* 图像 */
  imageDir: string;
  imageAutoInsert: boolean;
  imageMaxWidth: number;
  /** 存下来之前是否先缩尺寸、换格式。见 `lib/image-compress.ts`。 */
  imageCompress: boolean;
  /** 压缩时的长边上限，像素。 */
  imageMaxEdge: number;
  /** 压缩成 JPEG 时的质量，1–100。 */
  imageQuality: number;
  /** 本地保存，还是上传到 Git 图床。 */
  imageUploadMode: ImageUploadMode;
  gitProvider: GitProvider;
  /** `owner/repo`。 */
  gitRepo: string;
  gitBranch: string;
  /** 仓库内的目录，相对仓库根。 */
  gitImageDir: string;
  /**
   * 仅用于提示：私有仓库的 raw 地址需要凭证，插图后别人看不到。
   * 应用本身不需要知道，因为请求都是带 token 发的。
   */
  gitRepoPublic: boolean;

  /* 行为 */
  autoSave: boolean;
  autoSaveDelay: number;
  confirmBeforeDelete: boolean;
  restoreLastWorkspace: boolean;
  showSidebar: boolean;
  showOutline: boolean;
  sidebarWidth: number;
  /** 右侧大纲 / 信息栏的宽度，可以拖分栏边框改。 */
  infoWidth: number;

  /* 导出 */
  /** 另存为对话框里默认选中的格式。 */
  exportFormat: ExportFormat;
  /** 正文字体族名；空串表示用渲染器的默认衬线栈。 */
  exportBodyFont: string;
  /** 正文字号，pt（磅）。 */
  exportBodyFontSize: number;
  exportBodyLineHeight: number;
  /** 标题字体族名；空串表示跟随正文字体。 */
  exportHeadingFont: string;
  exportHeadingBold: boolean;
  /** 标题色，`#rrggbb`；空串表示用渲染器的默认色。 */
  exportHeadingColor: string;
  /** 一至六级标题的字号，pt。六项。 */
  exportHeadingSizes: number[];
  /** 一级标题的段前/段后间距，pt；更低的级别按比例递减。 */
  exportHeadingSpaceBefore: number;
  exportHeadingSpaceAfter: number;
  /** 代码字体族名；空串表示用内置等宽栈。 */
  exportCodeFont: string;
  exportCodeFontSize: number;
  /** 代码底色 `#rrggbb`；空串表示用渲染器的默认色。 */
  exportCodeBackground: string;
  exportPageSize: ExportPageSize;
  /** 页边距，mm。 */
  exportMarginTop: number;
  exportMarginBottom: number;
  exportMarginLeft: number;
  exportMarginRight: number;
  exportTableBorders: boolean;
  /** 表头底色 `#rrggbb`；空串表示用渲染器的默认色。 */
  exportTableHeaderFill: string;
  /** 图片最大宽度，正文宽度的百分比。 */
  exportImageMaxWidth: number;
  /** 是否把笔记标题写在正文之前。 */
  exportIncludeTitle: boolean;

  /* 更新 */
  /** 启动时自动检查一次。更新源是构建期配置，不是用户设置。 */
  autoCheckUpdate: boolean;
  /** 上次检查的时间，ISO 字符串；空串表示从未检查过。 */
  lastUpdateCheck: string;
  /**
   * 下载更新时走的代理，形如 `http://127.0.0.1:7890`；空串表示直连。
   *
   * 只有这一条运行时能改的旋钮：GitHub 的安装包在国内经常只有几十 KB/s，
   * 而 Tauri 的更新器会把这里填的代理同时用在检查与下载上（签名校验不变，
   * 代理既不能改包也不能绕过验签）。
   */
  updateProxy: string;
}
