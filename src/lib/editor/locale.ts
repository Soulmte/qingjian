import { CrepeFeature } from "@milkdown/crepe";

/**
 * Chinese labels for Crepe's built-in UI.
 *
 * Crepe ships English defaults for the slash menu, the selection toolbar's
 * native tooltips (`Bold (Ctrl+B)`), the image placeholders and the code
 * block's search / copy / preview chrome. Each of those is driven by a
 * `featureConfigs` entry, and Crepe merges the config over its defaults with
 * `defaultsDeep`, so listing only the text here is enough — nothing is turned
 * off by omission.
 *
 * Keep the toolbar labels free of keyboard hints: Crepe appends the chord from
 * its own keymap to the tooltip (`加粗 (Ctrl+B)`), so repeating it here would
 * double it up. Crepe reports the chord Milkdown's presets register, which can
 * differ from the Typora equivalent the shortcuts page documents; both work.
 */
export const editorLabels = {
  [CrepeFeature.BlockEdit]: {
    textGroup: {
      label: "文本",
      text: { label: "正文" },
      h1: { label: "一级标题" },
      h2: { label: "二级标题" },
      h3: { label: "三级标题" },
      h4: { label: "四级标题" },
      h5: { label: "五级标题" },
      h6: { label: "六级标题" },
      quote: { label: "引用" },
      divider: { label: "分割线" },
    },
    listGroup: {
      label: "列表",
      bulletList: { label: "无序列表" },
      orderedList: { label: "有序列表" },
      taskList: { label: "任务列表" },
    },
    advancedGroup: {
      label: "高级",
      image: { label: "图片" },
      codeBlock: { label: "代码块" },
      table: { label: "表格" },
      math: { label: "数学公式" },
    },
  },

  [CrepeFeature.Toolbar]: {
    boldLabel: "加粗",
    italicLabel: "斜体",
    strikethroughLabel: "删除线",
    codeLabel: "行内代码",
    linkLabel: "插入链接",
    latexLabel: "行内公式",
    aiLabel: "AI 写作",
  },

  [CrepeFeature.CodeMirror]: {
    searchPlaceholder: "搜索语言",
    copyText: "复制",
    noResultText: "无匹配语言",
    previewLabel: "预览",
    previewToggleText: (previewOnlyMode: boolean) => (previewOnlyMode ? "编辑" : "隐藏"),
  },

  [CrepeFeature.LinkTooltip]: {
    inputPlaceholder: "粘贴链接…",
  },

  [CrepeFeature.ImageBlock]: {
    inlineUploadButton: "上传",
    inlineUploadPlaceholderText: "或粘贴图片链接",
    blockUploadButton: "选择文件",
    blockUploadPlaceholderText: "或粘贴图片链接",
    blockConfirmButton: "确定",
    // Crepe 默认给的是一个深色圆气泡里的对话图标，浮在图片右上角，既看不清
    // 又和整体扁平风格冲突。换成文字标签，形状交给 `editor.css` 里的 `.operation` 规则。
    blockCaptionIcon: "图注",
    blockCaptionPlaceholderText: "输入图片说明",
  },
};

/** Placeholder shown in an empty document. */
export const EDITOR_PLACEHOLDER = "开始书写，输入 / 唤起插入菜单";
