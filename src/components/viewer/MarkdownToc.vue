<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useTocPanel } from "@/composables/useTocPanel";
import { useSettingsStore } from "@/stores/settings";
import type { MarkdownHeading } from "@/utils/markdown";

/**
 * Markdown 檢視器右上角的目錄索引面板。
 *
 * 只負責「面板」本身：位置、大小、收合、目錄清單與目前章節高亮。標題錨點、
 * 捲動同步與跳轉都在 `useMarkdownScrollSpy`（由 `MarkdownView` 持有），
 * 位置與拖曳手勢在 `useTocPanel`；這裡只把 `activeId` 畫出來、把點擊往上送。
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

const {
  rect,
  panelStyle,
  moving,
  resizing,
  onTitlePointerDown,
  onTitleKeydown,
  onResizePointerDown,
  onResizeKeydown,
} = useTocPanel({
  host: () => props.host,
  contentHeight: listHeight,
  collapsed,
});

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
  <div
    v-if="rect"
    class="toc-panel absolute z-30 flex flex-col overflow-hidden rounded-xl text-base"
    :style="{ ...panelStyle, '--toc-opacity': `${settings.markdownTocOpacity}%` }"
  >
    <div
      class="flex h-8 shrink-0 items-center gap-1 border-b px-2.5"
      :class="[!collapsed && 'border-line', moving ? 'cursor-grabbing' : 'cursor-grab']"
      tabindex="0"
      aria-label="目錄索引，可拖曳移動；方向鍵移動，Enter 收合或展開"
      @pointerdown="onTitlePointerDown"
      @keydown="onTitleKeydown"
    >
      <AppIcon name="toc" :size="14" class="text-ink-muted" />
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">目錄索引</span>
      <button
        type="button"
        class="flex size-6 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        :title="collapsed ? '展開目錄索引' : '收合目錄索引'"
        :aria-expanded="!collapsed"
        @click="settings.toggleMarkdownTocCollapsed()"
      >
        <AppIcon :name="collapsed ? 'chevronDown' : 'chevronUp'" :size="14" />
      </button>
    </div>

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

    <div
      v-if="!collapsed"
      class="absolute bottom-0 left-0 flex size-6 cursor-nesw-resize items-end justify-start pl-1 pb-1"
      :class="resizing ? 'text-accent' : 'text-ink-faint'"
      role="separator"
      aria-label="調整目錄索引大小；方向鍵調整寬高"
      tabindex="0"
      @pointerdown="onResizePointerDown"
      @keydown="onResizeKeydown"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M9 9 1 1" />
        <path d="M5 9 1 5" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
/*
 * 80% 半透明底色 + 背景模糊：看得見底下的內文，但文字對比仍然足夠。
 * 系統要求減少透明度時直接改回不透明，維持可讀性。
 */
.toc-panel {
  background: color-mix(in oklab, var(--color-menu) var(--toc-opacity, 50%), transparent);
  border: 1px solid var(--color-line);
  box-shadow:
    0 0 0 0.5px var(--color-hairline-bright) inset,
    0 12px 28px -8px oklch(0 0 0 / 0.28),
    0 2px 8px -2px oklch(0 0 0 / 0.18);
  /* 不透明度可以調到 50%，模糊要夠強才不會讓底下的文字穿過來干擾閱讀。 */
  backdrop-filter: blur(16px);
}

@media (prefers-reduced-transparency: reduce) {
  .toc-panel {
    background: var(--color-menu);
    backdrop-filter: none;
  }
}
</style>
