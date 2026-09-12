import { APP_COMMANDS } from "@/lib/commands";

/**
 * The shortcut reference, mirroring Typora's key map.
 *
 * `chords` is both what the page renders and what `isActive` verifies against
 * the app's real bindings, so an entry cannot be displayed as working unless
 * something actually listens for it. A test enforces that.
 */
export interface ShortcutEntry {
  /** One or more chords; more than one is an alternative binding. */
  chords: string[];
  description: string;
  /** Why an entry is not implemented, or how its key differs from Typora. */
  note?: string;
  /**
   * 明确标为未实现。
   *
   * 多数条目靠「这个键有没有被绑定」就能判断，但有一种情况推断不出来：键位
   * 存在、却被另一个命令占着（如 Ctrl+Shift+L 归了侧边栏切换，左对齐就没份）。
   * 这种情况必须显式写明，否则页面上会顶着「可用」的标签。
   */
  pending?: boolean;
}

export interface ShortcutGroup {
  title: string;
  entries: ShortcutEntry[];
}

/**
 * Chords the editor (or the browser's editable handling) provides outside the
 * command registry.
 *
 * These come from Milkdown's presets and `typoraKeymap`, plus the native
 * clipboard and undo behaviour of a contenteditable.
 */
const EDITOR_BINDINGS = new Set([
  "Ctrl+Z",
  "Ctrl+Y",
  "Ctrl+Shift+Z",
  "Ctrl+X",
  "Ctrl+C",
  "Ctrl+V",
  "Ctrl+A",
  "Ctrl+B",
  "Ctrl+I",
  "Ctrl+K",
  "Ctrl+T",
  "Ctrl+0",
  // Symbolic: `typoraKeymap` binds Mod-1 … Mod-6 individually.
  "Ctrl+1…6",
  "Ctrl+Shift+`",
  "Ctrl+Shift+[",
  "Ctrl+Shift+]",
  "Ctrl+Shift+K",
  "Alt+Shift+5",
  "Tab",
  "Shift+Tab",
]);

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "文件操作",
    entries: [
      { chords: ["Ctrl+N"], description: "新建文件" },
      { chords: ["F2"], description: "重命名当前笔记", note: "本应用新增；重命名时也可同时移动到其它文件夹" },
      {
        chords: ["Ctrl+Shift+N"],
        description: "新建窗口",
        note: "所有窗口共用同一个工作区数据库",
      },
      { chords: ["Ctrl+O"], description: "打开文件" },
      {
        chords: ["Ctrl+Shift+O"],
        description: "快速打开（搜索并打开笔记）",
        note: "原键位 Ctrl+P 与「打印」冲突，改用 Ctrl+Shift+O",
      },
      { chords: ["Ctrl+S"], description: "保存文件" },
      { chords: ["Ctrl+Shift+S"], description: "另存为 / 导出" },
      { chords: ["Ctrl+P"], description: "打印" },
      { chords: ["Ctrl+W"], description: "关闭文件" },
    ],
  },
  {
    title: "编辑操作",
    entries: [
      { chords: ["Ctrl+Z"], description: "撤销" },
      { chords: ["Ctrl+Y", "Ctrl+Shift+Z"], description: "重做" },
      { chords: ["Ctrl+X"], description: "剪切" },
      { chords: ["Ctrl+C"], description: "复制" },
      { chords: ["Ctrl+V"], description: "粘贴" },
      { chords: ["Ctrl+Shift+V"], description: "粘贴为纯文本" },
      { chords: ["Ctrl+F"], description: "查找" },
      { chords: ["Ctrl+H"], description: "替换" },
      { chords: ["Ctrl+A"], description: "全选" },
      { chords: ["Ctrl+L"], description: "选中当前行" },
      {
        chords: ["Ctrl+Shift+D"],
        description: "删除当前行",
        note: "原键位 Ctrl+Shift+K 与「插入代码块」冲突，改用 Ctrl+Shift+D",
      },
      { chords: ["Ctrl+K"], description: "插入链接" },
      { chords: ["Ctrl+Shift+I"], description: "插入图片" },
      { chords: ["Ctrl+T"], description: "插入表格" },
      { chords: ["Ctrl+Shift+K"], description: "插入代码块" },
      { chords: ["Ctrl+Shift+M"], description: "插入数学公式" },
    ],
  },
  {
    title: "格式设置",
    entries: [
      { chords: ["Ctrl+1…6"], description: "标题 1–6 级" },
      { chords: ["Ctrl+0"], description: "段落格式（取消标题，恢复为普通段落）" },
      { chords: ["Ctrl+B"], description: "加粗" },
      { chords: ["Ctrl+I"], description: "斜体" },
      { chords: ["Alt+Shift+5"], description: "删除线" },
      { chords: ["Ctrl+Shift+`"], description: "行内代码" },
      { chords: ["Ctrl+Shift+]"], description: "无序列表", note: "也可用 * + 空格" },
      { chords: ["Ctrl+Shift+["], description: "有序列表", note: "也可用 数字 + . + 空格" },
      { chords: ["Ctrl+Shift+X"], description: "任务列表（插入 - [ ]）" },
      { chords: ["Tab"], description: "缩进（列表内）" },
      { chords: ["Shift+Tab"], description: "取消缩进（列表内）" },
      {
        chords: ["Ctrl+Shift+E"],
        description: "居中对齐",
        note: "作用于当前段落 / 标题 / 图片；光标在表格里时作用于表格列",
      },
      {
        chords: ["Ctrl+Shift+R"],
        description: "右对齐",
        note: "作用于当前段落 / 标题 / 图片；光标在表格里时作用于表格列",
      },
      { chords: ["Ctrl+\\"], description: "清除格式" },
      {
        chords: ["Ctrl+U"],
        description: "下划线",
        note: "Markdown 没有下划线语法，只能写内联 HTML，暂不实现",
      },
      {
        chords: ["Ctrl+Shift+L"],
        description: "左对齐",
        pending: true,
        note: "该键位归了「显示 / 隐藏侧边栏」；左对齐请用顶部工具栏的对齐按钮，居中与右对齐在 Ctrl+Shift+E / R",
      },
    ],
  },
  {
    title: "视图操作",
    entries: [
      { chords: ["Ctrl+/"], description: "切换源代码模式" },
      { chords: ["Ctrl+G"], description: "跳转到标题（源代码模式下也可输入行号）" },
      { chords: ["Ctrl+Shift+L"], description: "显示 / 隐藏侧边栏" },
      { chords: ["Ctrl+Shift+1"], description: "大纲视图" },
      {
        chords: ["Ctrl+Shift+2"],
        description: "文件列表",
        note: "本应用只有一个文件面板，从侧边栏切换面板即可",
      },
      {
        chords: ["Ctrl+Shift+3"],
        description: "文件树",
        note: "与「文件列表」为同一面板",
      },
      { chords: ["Ctrl+Shift+="], description: "放大" },
      { chords: ["Ctrl+Shift+-"], description: "缩小" },
      { chords: ["Ctrl+Shift+0"], description: "恢复默认缩放" },
      { chords: ["F8"], description: "专注模式（只高亮当前段落）" },
      { chords: ["F9"], description: "打字机模式（当前行始终居中）" },
      { chords: ["F11"], description: "全屏模式" },
      {
        chords: ["Ctrl+Alt+N"],
        description: "切换夜间模式",
        note: "原键位 Ctrl+Shift+N 已给「新建窗口」",
      },
    ],
  },
  {
    title: "其他",
    entries: [
      { chords: ["Ctrl+Shift+P"], description: "命令面板" },
      { chords: ["Ctrl+,"], description: "打开偏好设置" },
      { chords: ["F1"], description: "打开帮助（快捷键说明）" },
      { chords: ["Ctrl+Q"], description: "关闭应用" },
    ],
  },
];

/** Every chord the app actually listens for. */
export function boundBindings(): Set<string> {
  const bound = new Set(EDITOR_BINDINGS);
  for (const command of APP_COMMANDS) {
    if (command.shortcut) bound.add(command.shortcut);
  }
  return bound;
}

/** Whether an entry is genuinely implemented: every chord it lists is bound. */
export function isActive(entry: ShortcutEntry, bound = boundBindings()): boolean {
  if (entry.pending) return false;
  return entry.chords.length > 0 && entry.chords.every((chord) => bound.has(chord));
}

/** Counts used by the section header. */
export function shortcutSummary(): { active: number; planned: number } {
  const bound = boundBindings();
  let active = 0;
  let planned = 0;
  for (const group of SHORTCUT_GROUPS) {
    for (const entry of group.entries) {
      if (isActive(entry, bound)) active += 1;
      else planned += 1;
    }
  }
  return { active, planned };
}
