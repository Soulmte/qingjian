import { Fragment, type ReactNode } from "react";

import { parseMarkdown, type Block, type Inline } from "@/lib/export/ir";

/**
 * 把更新说明（Markdown）渲染成 React 元素。
 *
 * 刻意**不用** `dangerouslySetInnerHTML`：这个 webview 没设 CSP，把远端拿到的
 * 内容当 HTML 注入等于开了个 XSS 口子。这里复用导出用的那套 Markdown 解析器
 * （`lib/export/ir` 已经过测试），只把解析结果映射成元素；认不出的块直接跳过，
 * 说明写复杂了顶多少显示几行，绝不会执行任何东西。
 *
 * 样式刻意压扁：这是弹窗里的一段附注，不是文章，标题不做字号阶梯，只做粗细
 * 与间距的区分，免得两三行说明被撑得很高。
 */

function inline(runs: Inline[], prefix: string): ReactNode[] {
  return runs.map((run, index) => {
    const key = `${prefix}-i${index}`;
    switch (run.t) {
      case "text":
        return <Fragment key={key}>{run.v}</Fragment>;
      case "bold":
        return (
          <strong key={key} className="font-semibold">
            {run.v}
          </strong>
        );
      case "italic":
        return <em key={key}>{run.v}</em>;
      case "strike":
        return <del key={key}>{run.v}</del>;
      case "code":
      case "math":
        // 公式在说明里只会是源码片段，按行内代码显示就够了
        return (
          <code key={key} className="rounded bg-default/60 px-1 py-px font-mono text-[0.9em]">
            {run.t === "code" ? run.v : run.tex}
          </code>
        );
      case "link":
        // 不做成可点：弹窗里跳出去会打断「要不要更新」这件事，
        // 真想看的人可以把地址复制走。地址一并显示，免得只剩个词。
        return (
          <span key={key} className="text-muted">
            {run.v}
          </span>
        );
      case "br":
        return <br key={key} />;
      case "image":
        return <Fragment key={key}>{run.v}</Fragment>;
      case "html":
        // 内联 HTML 按纯文本显示，不解析
        return <Fragment key={key}>{run.v}</Fragment>;
      default:
        return null;
    }
  });
}

function blocks(list: Block[], prefix: string): ReactNode[] {
  return list.map((block, index) => {
    const key = `${prefix}-b${index}`;
    switch (block.t) {
      case "heading":
        return (
          <p
            key={key}
            className={
              block.level <= 2
                ? "mt-3 text-sm font-semibold first:mt-0"
                : "mt-2.5 text-xs font-semibold first:mt-0"
            }
          >
            {inline(block.runs, key)}
          </p>
        );
      case "paragraph":
        return (
          <p key={key} className="mt-1.5 text-xs leading-relaxed first:mt-0">
            {inline(block.runs, key)}
          </p>
        );
      case "list": {
        const items = block.items.map((item, itemIndex) => (
          <li key={`${key}-l${itemIndex}`}>{blocks(item.blocks, `${key}-l${itemIndex}`)}</li>
        ));
        return block.ordered ? (
          <ol key={key} className="mt-1 ml-4 list-decimal space-y-0.5">
            {items}
          </ol>
        ) : (
          <ul key={key} className="mt-1 ml-4 list-disc space-y-0.5">
            {items}
          </ul>
        );
      }
      case "code":
        return (
          <pre
            key={key}
            className="mt-2 overflow-x-auto rounded-md bg-default/60 p-2 font-mono text-[11px] leading-relaxed"
          >
            <code>{block.text}</code>
          </pre>
        );
      case "mathBlock":
        return (
          <pre
            key={key}
            className="mt-2 overflow-x-auto rounded-md bg-default/60 p-2 font-mono text-[11px]"
          >
            <code>{block.tex}</code>
          </pre>
        );
      case "quote":
        return (
          <blockquote key={key} className="mt-1.5 border-l-2 border-border pl-2.5 text-muted">
            {blocks(block.blocks, key)}
          </blockquote>
        );
      case "hr":
        return <hr key={key} className="my-2.5 border-0 border-t border-border/80" />;
      // 表格与图片在更新说明里不常见，宁可少显示也不塞进一个没样式的宽表
      case "table":
      case "image":
      default:
        return null;
    }
  });
}

export function ReleaseNotes({ markdown }: { markdown: string }) {
  // 解析器能读懂的大多是我们要的；万一整段解析不出来，还有原文兜底
  let tree: Block[] = [];
  try {
    tree = parseMarkdown(markdown);
  } catch {
    tree = [];
  }

  if (tree.length === 0) {
    return <p className="text-xs leading-relaxed whitespace-pre-wrap">{markdown}</p>;
  }
  return <div className="text-foreground/85">{blocks(tree, "n")}</div>;
}
