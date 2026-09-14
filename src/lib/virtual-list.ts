/**
 * 长列表只渲染看得见的那几十行。
 *
 * 侧边栏的文件树有两种很不一样的规模：一个笔记工作区可能只有几十个文件，而
 * 「工作区就是代码仓库」时轻松上万个。全部塞进 DOM 的代价不是线性增长的——
 * 每次展开、每次刷新、每次搜索都要为每一个节点建元素、跑一次布局，用户感受到
 * 的是「点了没反应」。
 *
 * 这里的做法是最朴素的一种：行高固定，知道滚动位置就能算出该渲染哪一段，把
 * 它后面的行用一个占位高度的空盒子撑住。行高固定是刻意的取舍——自适应行高要
 * 先量再排，一轮下来比省下的那些元素还贵，而且滚动时会出现跳动。
 *
 * 计算部分不碰 DOM，所以可以单独测（见 `virtual-list.test.ts`）。
 */

/** 一行节点在扁平列表里的位置。 */
export interface FlatNode<T> {
  node: T;
  depth: number;
}

/** 至少要能构成树的最小形状。 */
interface TreeNode {
  path: string;
  isDir: boolean;
  children: unknown[];
}

/**
 * 把树摊成一行一行，顺序与在屏幕上从上到下看到的完全一致。
 *
 * 折叠的子树整段跳过——这正是虚拟化能生效的原因：摊平之后，索引就是像素位置，
 * 而折叠决定了索引到哪一段为止。
 */
export function flattenTree<T extends TreeNode>(
  entries: T[],
  collapsed: ReadonlySet<string>,
): FlatNode<T>[] {
  const rows: FlatNode<T>[] = [];

  const walk = (nodes: T[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth });
      if (node.isDir && !collapsed.has(node.path)) {
        walk(node.children as T[], depth + 1);
      }
    }
  };

  walk(entries, 0);
  return rows;
}

export interface VirtualWindow {
  /** 第一个要渲染的行号。 */
  start: number;
  /** 最后一个要渲染的行号（不含）。 */
  end: number;
  /** 第一行距离内容顶端的像素数，已经算上过扫描。 */
  offsetY: number;
  /** 占位盒子的总高度。 */
  totalHeight: number;
}

export interface VirtualWindowInput {
  count: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  /** 视口上下各多渲染几行，给快速滚动留余地。 */
  overscan?: number;
  /** 内容上下各留的空白，用来对齐容器自己的 padding。 */
  paddingY?: number;
}

export function virtualWindow({
  count,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = 8,
  paddingY = 0,
}: VirtualWindowInput): VirtualWindow {
  const totalHeight = count * rowHeight + paddingY * 2;
  if (count === 0 || rowHeight <= 0) {
    return { start: 0, end: 0, offsetY: paddingY, totalHeight };
  }

  // 视口高度还没量出来（首帧、或者容器被隐藏成 0 高）时先多渲染一些，否则会
  // 出现「内容明明在，屏幕却是空的」。
  const height = viewportHeight > 0 ? viewportHeight : rowHeight * 20;

  const first = Math.floor((scrollTop - paddingY) / rowHeight);
  const start = Math.max(0, Math.min(count - 1, first - overscan));
  const visible = Math.ceil(height / rowHeight) + overscan * 2 + 1;
  const end = Math.min(count, start + visible);

  return { start, end, offsetY: paddingY + start * rowHeight, totalHeight };
}
