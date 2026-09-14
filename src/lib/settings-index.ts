import type { SettingsSection } from "@/lib/settings-sections";

/**
 * Every row in the settings, for the search box.
 *
 * Generated from the section sources — `SettingRow.label` and its `hint` — so the
 * labels are the ones actually on screen. A test walks the sources again and fails
 * when a label here no longer exists, which is how a rename gets noticed instead of
 * producing a search result that jumps nowhere.
 *
 * `hint` is searched too: people look for 拼写 or 延迟, not for the label above it.
 *
 * Regenerate with `python scripts/gen_settings_index.py`.
 */
export interface SettingsIndexEntry {
  section: SettingsSection;
  /** The group this row sits under, used to name it unambiguously. */
  group: string;
  label: string;
  hint: string;
}

export const SETTINGS_INDEX: SettingsIndexEntry[] = [
  { section: "appearance", group: "明暗", label: "外观模式", hint: "跟随系统时会自动响应操作系统的深浅色切换" },
  { section: "appearance", group: "主题", label: "主题色", hint: "强调色用在当前项、焦点环、主操作与链接上；画布只沾一点它的色相" },
  { section: "appearance", group: "界面", label: "界面字体", hint: "" },
  { section: "appearance", group: "界面", label: "圆角", hint: "作用于按钮、输入框与卡片" },
  { section: "appearance", group: "界面", label: "界面缩放", hint: "正文与界面一起缩放；快捷键 Ctrl+Shift+= / Ctrl+Shift+-，Ctrl+Shift+0 复位" },
  { section: "editor", group: "排版", label: "正文字号", hint: "标题与代码会按比例缩放" },
  { section: "editor", group: "排版", label: "行高", hint: "作用于正文、列表、表格与引用；标题保留自己的紧凑行距" },
  { section: "editor", group: "排版", label: "正文宽度", hint: "书写区域的列宽上限，过大时换行会变得吃力" },
  { section: "editor", group: "正文字体", label: "字体族", hint: "从本机读取" },
  { section: "editor", group: "校对", label: "拼写检查", hint: "使用系统拼写词典，仅对英文生效" },
  { section: "editor", group: "沉浸写作", label: "专注模式", hint: "只高亮光标所在段落，其余内容淡化（F8）" },
  { section: "editor", group: "沉浸写作", label: "打字机模式", hint: "光标所在行始终停在视口中央（F9）" },
  { section: "code", group: "代码块背景", label: "亮色", hint: "与明暗模式无关，六个背景可以任意搭配" },
  { section: "code", group: "代码块背景", label: "暗色", hint: "" },
  { section: "code", group: "等宽字体", label: "字体族", hint: "" },
  { section: "code", group: "等宽字体", label: "代码字号", hint: "" },
  { section: "markdown", group: "语法支持", label: "数学公式", hint: "支持行内 $…$ 与块级 $$…$$，由 KaTeX 渲染" },
  { section: "markdown", group: "语法支持", label: "表格", hint: "启用 GFM 表格，可在单元格内直接编辑" },
  { section: "markdown", group: "语法支持", label: "代码语法高亮", hint: "关闭后代码块退化为纯文本，其它功能不受影响" },
  { section: "markdown", group: "编辑辅助", label: "链接悬浮提示", hint: "点击链接时显示编辑与打开入口" },
  { section: "markdown", group: "编辑辅助", label: "块拖拽手柄", hint: "悬停段落左侧时出现手柄与斜杠菜单" },
  { section: "image", group: "存放位置", label: "模式", hint: "本地路径可离线、可移植；图床给出公开地址，但依赖远端仓库" },
  { section: "image", group: "存放位置", label: "图片文件夹", hint: "相对工作区根目录；目录不存在时自动创建" },
  { section: "image", group: "存放位置", label: "平台", hint: "Gitee 的接口与 GitHub 基本一致，认证方式不同" },
  { section: "image", group: "存放位置", label: "仓库", hint: "" },
  { section: "image", group: "存放位置", label: "分支", hint: "图片会提交到这个分支" },
  { section: "image", group: "存放位置", label: "仓库内目录", hint: "图片在仓库中的存放目录" },
  { section: "image", group: "存放位置", label: "仓库可见性", hint: "只影响提示；请求始终带令牌发送" },
  { section: "image", group: "存放位置", label: "私有仓库的提示", hint: "raw 地址需要凭证才能访问，你自己能看到，但别人打不开这些图片" },
  { section: "image", group: "存放位置", label: "访问令牌", hint: "" },
  { section: "image", group: "存放位置", label: "连接检测", hint: "按当前平台、仓库、分支校验一次，确认令牌有读写权限" },
  { section: "image", group: "粘贴与拖入", label: "自动插入引用", hint: "写入后直接在光标处插入 Markdown 图片语法" },
  { section: "image", group: "粘贴与拖入", label: "保存前压缩", hint: "长边超过上限的缩小、生僻格式转成 JPEG；PNG 只缩尺寸，避免文字边上出现压缩噪声" },
  { section: "image", group: "粘贴与拖入", label: "长边上限", hint: "按比例缩到这么宽，不裁剪" },
  { section: "image", group: "粘贴与拖入", label: "JPEG 质量", hint: "只影响转成 JPEG 的图，PNG 用不到" },
  { section: "image", group: "显示", label: "最大宽度", hint: "约束正文中图片的显示宽度，始终按比例缩放" },
  { section: "export", group: "导出方式", label: "默认格式", hint: "「导出」对话框里默认选中的格式；改成别的扩展名也会按扩展名输出" },
  { section: "export", group: "导出方式", label: "写入标题", hint: "把笔记标题作为文档的第一个一级标题写在正文之前" },
  { section: "export", group: "页面", label: "纸张", hint: "" },
  { section: "export", group: "页面", label: "页边距", hint: "上下左右，单位毫米" },
  { section: "export", group: "页面", label: "左右边距", hint: "上下左右，单位毫米" },
  { section: "export", group: "正文", label: "字体", hint: "留空则跟随编辑器正文字体" },
  { section: "export", group: "正文", label: "字号", hint: "" },
  { section: "export", group: "正文", label: "行距", hint: "" },
  { section: "export", group: "标题", label: "各级字号", hint: "对应 Word 的「标题 1」到「标题 6」样式，单位磅" },
  { section: "export", group: "标题", label: "字体", hint: "留空则跟随正文字体" },
  { section: "export", group: "标题", label: "加粗", hint: "" },
  { section: "export", group: "标题", label: "颜色", hint: "形如 #1a1a1a；留空使用默认色" },
  { section: "export", group: "标题", label: "段前间距", hint: "一级标题的值；更低的级别按比例递减" },
  { section: "export", group: "标题", label: "段后间距", hint: "" },
  { section: "export", group: "代码", label: "字体", hint: "留空则跟随编辑器代码字体" },
  { section: "export", group: "代码", label: "字号", hint: "" },
  { section: "export", group: "代码", label: "底色", hint: "形如 #f5f5f5；留空使用默认浅灰" },
  { section: "export", group: "表格与图片", label: "表格边框", hint: "" },
  { section: "export", group: "表格与图片", label: "表头底色", hint: "形如 #f2f2f2；留空使用默认浅灰" },
  { section: "export", group: "表格与图片", label: "图片最大宽度", hint: "占正文宽度的百分比" },
  { section: "behavior", group: "保存", label: "自动保存", hint: "关闭后需要手动按 Ctrl+S 才会写入磁盘" },
  { section: "behavior", group: "保存", label: "保存延迟", hint: "" },
  { section: "behavior", group: "启动与删除", label: "启动时恢复上次工作区", hint: "关闭后启动停留在空状态" },
  { section: "behavior", group: "启动与删除", label: "删除前确认", hint: "关闭后删除笔记不再弹出确认框" },
  { section: "behavior", group: "布局", label: "默认显示侧边栏", hint: "" },
  { section: "behavior", group: "布局", label: "默认显示大纲", hint: "" },
  { section: "behavior", group: "布局", label: "侧边栏宽度", hint: "也可以在界面上直接拖拽分栏边框" },
  { section: "behavior", group: "重置", label: "恢复全部默认设置", hint: "外观、编辑器、代码、Markdown、图像（含图床仓库与分支）、导出与行为的每一项都回到初始值；只影响设置，笔记内容与已保存的访问令牌不受影响" },
  { section: "updates", group: "版本", label: "当前版本", hint: "" },
  { section: "updates", group: "版本", label: "上次检查", hint: "" },
  { section: "updates", group: "版本", label: "启动时自动检查", hint: "每次启动查一次，有新版本时弹窗提示。" },
  { section: "updates", group: "网络", label: "下载代理", hint: "形如 http://127.0.0.1:7890；留空则直连。只作用于青简自己的更新请求（检查与下载都走它），安装前仍会校验签名" },
  { section: "updates", group: "检查", label: "检查更新", hint: "" },
];
