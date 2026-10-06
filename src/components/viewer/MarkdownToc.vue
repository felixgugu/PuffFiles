<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import FloatingPanel from "./FloatingPanel.vue";
import { useSettingsStore } from "@/stores/settings";
import type { MarkdownHeading } from "@/utils/markdown";

/**
 * Markdown 檢視器右上角的目錄索引面板。
 *
 * 只負責「面板」本身：位置、大小、收合、目錄清單與目前章節高亮。標題錨點、
 * 捲動同步與跳轉都在 `useMarkdownScrollSpy`（由 `MarkdownView` 持有），
 * 位置與拖曳手勢在 `FloatingPanel`／`useViewerPanel`；這裡只量清單高度、
 * 把 `activeId` 畫出來、把點擊往上送。
 */
const props = defineProps<{
  headings: MarkdownHeading[];
  activeId: string | null;
  /** 定位容器（MarkdownView 的根節點）；量測可用範圍用。 */
  host: HTMLElement | null;
}>();

const emit = defineEmits<{ jump: [id: string] }>();

const settings = useSettingsStore();
const collapsed = computed(() => settings.markdownTocCollapsed);

const listEl = useTemplateRef<HTMLElement>("list");
const listHeight = ref(0);

function measureList() {
  listHeight.value = listEl.value?.scrollHeight ?? 0;
}

/*
 * 面板要等量到容器尺寸才會真的畫出來（`rect` 從 null 變成物件），所以清單
 * 元素是後掛上來的；除了標題換一批，清單本身出現時也要重新量一次自然高度。
 */
watch(
  [listEl, () => props.headings, collapsed],
  () => {
    void nextTick(measureList);
  },
  { flush: "post" },
);

/** 目前章節若捲出目錄可視範圍，把它帶回清單內（只動這個清單的 scrollTop）。 */
watch(
  () => props.activeId,
  (id) => {
    const list = listEl.value;
    if (!id || !list) {
      return;
    }
    const item = Array.from(list.querySelectorAll<HTMLElement>("[data-toc-id]")).find(
      (element) => element.dataset.tocId === id,
    );
    if (!item) {
      return;
    }
    // 用矩形差值而不是 offsetTop：面板本身是定位元素，offsetParent 不是清單。
    const listRect = list.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    if (itemRect.top < listRect.top) {
      list.scrollTop += itemRect.top - listRect.top;
    } else if (itemRect.bottom > listRect.bottom) {
      list.scrollTop += itemRect.bottom - listRect.bottom;
    }
  },
);
</script>

<template>
  <FloatingPanel
    panel="toc"
    title="目錄索引"
    icon="toc"
    drag-label="目錄索引，可拖曳移動；方向鍵移動，Enter 收合或展開"
    resize-label="調整目錄索引大小；方向鍵調整寬高"
    :host="host"
    :collapsed="collapsed"
    :initial-layout="settings.markdownTocPanel"
    :content-height="listHeight"
    @persist="settings.setMarkdownTocPanel"
    @toggle-collapse="settings.toggleMarkdownTocCollapsed()"
  >
    <nav
      v-if="!collapsed"
      ref="list"
      class="scroll-area min-h-0 flex-1 overflow-y-auto p-1"
      aria-label="目錄索引"
    >
      <button
        v-for="heading in headings"
        :key="heading.id"
        type="button"
        :data-toc-id="heading.id"
        class="flex w-full items-center rounded-md py-1 pr-2 text-left text-sm pressable"
        :class="
          heading.id === activeId
            ? 'bg-accent-soft text-accent'
            : 'text-ink-muted hover:bg-surface-hover hover:text-ink active:bg-pressed'
        "
        :style="{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }"
        :title="heading.text"
        :aria-current="heading.id === activeId ? 'location' : undefined"
        @click="emit('jump', heading.id)"
      >
        <span class="truncate">{{ heading.text || "（無標題）" }}</span>
      </button>
    </nav>
  </FloatingPanel>
</template>
