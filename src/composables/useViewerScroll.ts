import { nextTick, onBeforeUnmount, onMounted, type Ref } from "vue";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";

/**
 * 文字類檢視器的內容捲動位置。
 *
 * 分頁切換時 `WorkspaceView` 只渲染焦點分頁的窗格，其餘整塊卸載 —— 內容區的
 * `scrollTop` 會跟著消失。這裡在捲動與卸載時把位置寫回 viewer store，重新掛載
 * 之後再還原，切回分頁才會停在原來讀到的地方。
 */
export function useViewerScroll(paneId: PaneId, element: Ref<HTMLElement | null>) {
  const viewer = useViewerStore();

  /**
   * 還原位置：內容（Markdown 渲染、語法高亮）在掛載時才寫進 DOM，等一個 tick
   * 之後高度才對得上，`scrollTop` 也才設得進去。
   */
  function restore() {
    const target = element.value;
    if (!target) {
      return;
    }
    target.scrollTop = viewer.of(paneId)?.scrollTop ?? 0;
  }

  function save() {
    const target = element.value;
    if (target) {
      viewer.setScrollTop(paneId, target.scrollTop);
    }
  }

  onMounted(() => {
    void nextTick(restore);
  });

  // 卸載前補記一次：捲動事件寫回的是滾動過程中的值，最後停住的位置要靠這裡。
  onBeforeUnmount(save);

  return { save };
}
