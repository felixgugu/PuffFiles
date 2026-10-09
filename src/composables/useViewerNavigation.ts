import { computed } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";

/** 標頭捲動鈕的四個動作。 */
export type ViewerScrollAction = "top" | "bottom" | "page-up" | "page-down";

/**
 * 檢視器內容的捲動容器（每個窗格一個）。
 *
 * 標頭在上、內容在下，兩邊沒有共同的父元件可以傳 ref，所以由內容這一側註冊
 * （`useViewerScroll` 與 `HtmlView`），標頭只問「這個窗格現在捲的是哪一個元素」。
 * 刻意不放進 viewer store 的響應式狀態：DOM 元素不需要也不該被追蹤。
 */
const scrollers = new Map<PaneId, Element>();

export function registerViewerScroller(paneId: PaneId, element: Element | null): void {
  if (element) {
    scrollers.set(paneId, element);
  } else {
    scrollers.delete(paneId);
  }
}

/** 逐頁的位移＝可視高度的這個比例（與瀏覽器一頁的視覺行數一致，留一點重疊）。 */
const PAGE_RATIO = 0.9;
/** 判定「已經在最上面／最下面」的容差。 */
const EDGE_SLACK = 1;

/**
 * 把「現在貼在最上面／最下面」寫回 store，標頭的捲動鈕據此停用。
 *
 * 寫進去的是布林值而不是原始量測值：相同的值不會觸發更新，所以捲動過程中只有
 * 跨越端點時標頭才會重繪，不必每一幀跟著捲動重畫。
 */
export function reportScrollEdges(paneId: PaneId, element: Element): void {
  useViewerStore().setScrollEdges(
    paneId,
    element.scrollTop <= EDGE_SLACK,
    element.scrollTop + element.clientHeight >= element.scrollHeight - EDGE_SLACK,
  );
}

/**
 * 捲動這個窗格的檢視器內容。
 *
 * 容器還沒註冊（內容還沒進 DOM、HTML 預覽還在載入）時直接不做 —— 呼叫端
 * （標頭按鈕與快速鍵）不需要自己判斷時機。
 */
export function scrollViewer(paneId: PaneId, action: ViewerScrollAction): void {
  const element = scrollers.get(paneId);
  if (!element) {
    return;
  }
  const settings = useSettingsStore();
  const behavior = settings.reduceMotion ? "auto" : "smooth";
  const step = Math.max(1, Math.round(element.clientHeight * PAGE_RATIO));

  switch (action) {
    case "top":
      element.scrollTo({ top: 0, behavior });
      return;
    case "bottom":
      element.scrollTo({ top: element.scrollHeight, behavior });
      return;
    case "page-up":
      element.scrollTo({ top: element.scrollTop - step, behavior });
      return;
    case "page-down":
      element.scrollTo({ top: element.scrollTop + step, behavior });
  }
}

/** 標頭的捲動鈕要停用哪幾顆（沒有這個檢視器時兩端都算 true＝停用）。 */
export function useViewerScrollEdges(paneId: PaneId) {
  const viewer = useViewerStore();
  return computed(() => {
    const state = viewer.of(paneId);
    return { atTop: state?.atTop ?? true, atBottom: state?.atBottom ?? true };
  });
}
