/**
 * 两份 Markdown 是不是同一篇文档。
 *
 * 比的是解析出来的块结构，而不是字符。同一篇文档有很多种写法，而 Milkdown 的
 * 序列化每次都只挑其中一种：分隔线写出来是 `***` 而不是 `---`，无序列表写出来
 * 是 `-`，表格两侧补过的空格会被收掉。这些都是同一篇文档的另一种写法，不是改动。
 *
 * 借导出那套解析器来判定是图一致：它已经是全应用唯一一处「Markdown → 结构」的
 * 实现，另写一个只会多一套迟早会漂移的规则。它顺带会盖掉 YAML 区块——两边都不
 * 该因为那段被判成不同，编辑器根本不看它（见 `MarkdownEditor` 里的 `initialContent`）。
 *
 * 只在编辑器刚建好时走一次，所以「整篇解析两遍」这点开销可以接受；每敲一个字都
 * 比一次的代价才是不能接受的。
 */

import { parseMarkdown } from "@/lib/export/ir";

export function sameDocument(left: string, right: string): boolean {
  // 字符一样就不必解析，而这是最常见的一种情况。
  if (left === right) return true;

  return JSON.stringify(parseMarkdown(left)) === JSON.stringify(parseMarkdown(right));
}
