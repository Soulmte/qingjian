import { useCallback, useRef, useState } from "react";

import { virtualWindow, type VirtualWindow } from "@/lib/virtual-list";

/**
 * 盯着一个滚动容器，算出当前该渲染哪一段。
 *
 * 挂载时量一次、滚动时量一次、容器尺寸变化时再量一次。三件事都要，少一件就会
 * 出现「第一次打开少了半屏」或者「拖动窗口之后列表停在原地」这类问题。
 *
 * 用回调 ref 而不是 `useRef` + `useEffect`：列表空的时候容器根本不渲染（界面上
 * 是空状态），`useRef` 那一版会在挂载时拿到 `null` 然后直接返回，而依赖数组是空
 * 的，等笔记加载完、容器真出现了也没有第二次机会——监听器永远不会挂上，滚动就
 * 成了「滚了但内容不变」。回调 ref 在节点真正出现时才被调用，正好对上。
 */
export function useVirtualList(count: number, rowHeight: number, paddingY = 0) {
  const [state, setState] = useState({ scrollTop: 0, viewportHeight: 0 });
  const detach = useRef<(() => void) | null>(null);

  const ref = useCallback((element: HTMLDivElement | null) => {
    // 节点换了一个（或卸载了）时先摘掉旧的监听器。
    detach.current?.();
    detach.current = null;
    if (!element) return;

    const measure = () => {
      setState((previous) => {
        const next = { scrollTop: element.scrollTop, viewportHeight: element.clientHeight };
        // 停下来时就别再触发渲染了：滚动一次会连发好几个事件，值却常常一样。
        if (
          next.scrollTop === previous.scrollTop &&
          next.viewportHeight === previous.viewportHeight
        ) {
          return previous;
        }
        return next;
      });
    };

    measure();
    element.addEventListener("scroll", measure, { passive: true });

    // 侧栏可以拖宽、窗口可以缩放、笔记数变化也会改变容器高度。
    const observer = new ResizeObserver(measure);
    observer.observe(element);

    detach.current = () => {
      element.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  return { ref, range: virtualWindow({ count, rowHeight, paddingY, ...state }) };
}

export type { VirtualWindow };
