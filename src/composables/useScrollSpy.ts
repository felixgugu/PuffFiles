import { nextTick, onBeforeUnmount, ref, watch, type ComputedRef } from "vue";
import { useSettingsStore } from "@/stores/settings";

/** 判定「目前章節」的掃描線：捲動容器頂端再加這麼多 px。 */
const ACTIVE_OFFSET = 24;
/** 跳轉後項目與容器頂端的留白。 */
const JUMP_OFFSET = 8;

/** 捲動同步與跳轉認得的目標：元素與 `Range` 都量得出 `getBoundingClientRect()`。 */
export type ScrollTarget = Element | Range;

interface ScrollSpyOptions {
  /** 捲動容器（量 rect 與設定 scrollTop 都用它）。 */
  root: () => HTMLElement | null;
  /** 這一輪的項目 id，依文件順序。 */
  ids: ComputedRef<string[]>;
  /** id → 目標；對不到位置時回 null（該項目不會參與高亮與跳轉）。 */
  resolve: (id: string) => ScrollTarget | null;
  /** 內容重繪訊號：元素換了一批（或位置重算完成）就重新判定目前章節。 */
  revision?: () => unknown;
}

/**
 * 「目前讀到哪一節」的捲動同步與跳轉。
 *
 * 目錄索引（Markdown 的標題、DOCX 的書籤）共用同一套：項目與元素的對應關係由
 * 呼叫端提供 —— Markdown 是「標題 id → DOM 元素」的快取，DOCX 是書籤錨點對回
 * 目前 DOM 的結果 —— 這裡只管捲動事件、掃描線與捲動位置。
 */
export function useScrollSpy(options: ScrollSpyOptions) {
  const settings = useSettingsStore();
  const activeId = ref<string | null>(null);
  let frame = 0;

  /** 取最後一個位於掃描線之上的項目；捲動時以 rAF 節流。 */
  function updateActive() {
    frame = 0;
    const root = options.root();
    const ids = options.ids.value;
    if (!root || !ids.length) {
      activeId.value = null;
      return;
    }
    const line = root.getBoundingClientRect().top + ACTIVE_OFFSET;
    let current = ids[0];
    for (const id of ids) {
      const element = options.resolve(id);
      if (!element) {
        continue;
      }
      if (element.getBoundingClientRect().top <= line) {
        current = id;
      } else {
        break;
      }
    }
    // 捲到底時，最後一個項目可能永遠到不了掃描線（下面還有內文）；
    // 這種情況直接算最後一節，否則點最後一項會高亮回上一個章節。
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
      current = ids[ids.length - 1];
    }
    activeId.value = current;
  }

  /** 內容或元素對應變了：立刻重算一次（呼叫端已經把新的元素準備好了）。 */
  function refresh() {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    updateActive();
  }

  function onScroll() {
    if (!frame) {
      frame = requestAnimationFrame(updateActive);
    }
  }

  function jumpTo(id: string) {
    const root = options.root();
    const element = options.resolve(id);
    if (!root || !element) {
      return;
    }
    // 捲動是「內容整體平移」，所以 rect 的差值就是 scrollTop 的差值
    // ——即使頁面被 `.docx-wrapper` 的 `zoom` 縮放過也一樣成立。
    const top =
      element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    root.scrollTo({
      top: Math.max(0, top - JUMP_OFFSET),
      behavior: settings.reduceMotion ? "auto" : "smooth",
    });
    activeId.value = id;
  }

  watch(
    options.root,
    (root, previous) => {
      previous?.removeEventListener("scroll", onScroll);
      if (root) {
        root.addEventListener("scroll", onScroll, { passive: true });
        void nextTick(refresh);
      } else {
        activeId.value = null;
      }
    },
    { immediate: true, flush: "post" },
  );

  // 項目換一批、或元素對應重算完成：重新判定目前章節。
  watch(
    [options.ids, () => options.revision?.()],
    () => void nextTick(refresh),
    { flush: "post" },
  );

  onBeforeUnmount(() => {
    options.root()?.removeEventListener("scroll", onScroll);
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  });

  return { activeId, jumpTo, refresh };
}
