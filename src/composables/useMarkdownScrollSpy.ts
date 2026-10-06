import { nextTick, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import type { MarkdownHeading } from "@/utils/markdown";

/** 判定「目前章節」的掃描線：捲動容器頂端再加這麼多 px。 */
const ACTIVE_OFFSET = 24;
/** 跳轉後標題與容器頂端的留白。 */
const JUMP_OFFSET = 8;

/**
 * Markdown 內文的捲動同步與錨點跳轉。
 *
 * 目錄索引的高亮、點擊跳轉與文件內 `#錨點` 連結都走同一條路：先建立
 * 「標題 id → DOM 元素」的快取，再共用同一個捲動容器。查詢範圍限定在這個
 * 窗格的內容根節點，所以分割時兩個 Markdown 窗格即使有相同 slug 也不會互搶。
 */
export function useMarkdownScrollSpy(
  content: Ref<HTMLElement | null>,
  headings: ComputedRef<MarkdownHeading[]>,
) {
  const settings = useSettingsStore();
  const activeId = ref<string | null>(null);
  const elements = new Map<string, HTMLElement>();
  let frame = 0;

  function rebuild() {
    elements.clear();
    activeId.value = null;
    const root = content.value;
    if (!root) {
      return;
    }
    const ids = new Set(headings.value.map((heading) => heading.id));
    for (const element of root.querySelectorAll<HTMLElement>("[id]")) {
      if (ids.has(element.id)) {
        elements.set(element.id, element);
      }
    }
    updateActive();
  }

  /** 取最後一個位於掃描線之上的標題；捲動時以 rAF 節流。 */
  function updateActive() {
    frame = 0;
    const root = content.value;
    const list = headings.value;
    if (!root || !list.length) {
      activeId.value = null;
      return;
    }
    const line = root.getBoundingClientRect().top + ACTIVE_OFFSET;
    let current = list[0].id;
    for (const heading of list) {
      const element = elements.get(heading.id);
      if (!element) {
        continue;
      }
      if (element.getBoundingClientRect().top <= line) {
        current = heading.id;
      } else {
        break;
      }
    }
    // 捲到底時，最後一個標題可能永遠到不了掃描線（下面還有內文）；
    // 這種情況直接算最後一節，否則點最後一項會高亮回上一個章節。
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
      current = list[list.length - 1].id;
    }
    activeId.value = current;
  }

  function onScroll() {
    if (!frame) {
      frame = requestAnimationFrame(updateActive);
    }
  }

  function jumpTo(id: string) {
    const root = content.value;
    const element = elements.get(id);
    if (!root || !element) {
      return;
    }
    const top =
      element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    root.scrollTo({
      top: Math.max(0, top - JUMP_OFFSET),
      behavior: settings.reduceMotion ? "auto" : "smooth",
    });
    activeId.value = id;
  }

  watch(
    content,
    (root, previous) => {
      previous?.removeEventListener("scroll", onScroll);
      if (root) {
        root.addEventListener("scroll", onScroll, { passive: true });
        void nextTick(rebuild);
      } else {
        elements.clear();
        activeId.value = null;
      }
    },
    { immediate: true, flush: "post" },
  );

  // `v-html` 換內容後 DOM 是全新的，標題元素快取要跟著重建。
  watch(
    headings,
    () => {
      void nextTick(rebuild);
    },
    { flush: "post" },
  );

  onBeforeUnmount(() => {
    content.value?.removeEventListener("scroll", onScroll);
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  });

  return { activeId, jumpTo };
}
