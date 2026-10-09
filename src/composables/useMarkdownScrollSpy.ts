import { computed, nextTick, watch, type ComputedRef, type Ref } from "vue";
import { useScrollSpy } from "@/composables/useScrollSpy";
import type { MarkdownHeading } from "@/utils/markdown";

/**
 * Markdown 內文的捲動同步與錨點跳轉。
 *
 * 目錄索引的高亮、點擊跳轉與文件內 `#錨點` 連結都走同一條路：先建立
 * 「標題 id → DOM 元素」的快取，再共用同一個捲動容器。查詢範圍限定在這個
 * 窗格的內容根節點，所以分割時兩個 Markdown 窗格即使有相同 slug 也不會互搶；
 * 掃描線與捲動位置本身在 `useScrollSpy`（與 DOCX 的書籤目錄共用）。
 */
export function useMarkdownScrollSpy(
  content: Ref<HTMLElement | null>,
  headings: ComputedRef<MarkdownHeading[]>,
) {
  const elements = new Map<string, HTMLElement>();
  const ids = computed(() => headings.value.map((heading) => heading.id));

  const spy = useScrollSpy({
    root: () => content.value,
    ids,
    resolve: (id) => elements.get(id) ?? null,
  });

  function rebuild() {
    elements.clear();
    const root = content.value;
    if (!root) {
      spy.refresh();
      return;
    }
    const wanted = new Set(ids.value);
    for (const element of root.querySelectorAll<HTMLElement>("[id]")) {
      if (wanted.has(element.id)) {
        elements.set(element.id, element);
      }
    }
    spy.refresh();
  }

  // `v-html` 換內容或換檔後 DOM 是全新的，標題元素快取要跟著重建。
  watch(
    [content, headings],
    () => {
      void nextTick(rebuild);
    },
    { immediate: true, flush: "post" },
  );

  return { activeId: spy.activeId, jumpTo: spy.jumpTo };
}
