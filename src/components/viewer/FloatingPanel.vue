<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import type { IconName } from "@/components/common/icons";
import { useViewerPanel } from "@/composables/useViewerPanel";
import { useSettingsStore } from "@/stores/settings";
import type { PanelLayout } from "@/utils/viewerPanel";

/**
 * 檢視器浮動面板的外殼：標題列（圖示＋名稱＋收合鈕）、拖曳移動、
 * 左下角縮放把手、半透明材質。目錄索引與搜尋面板共用這一層，
 * 內容由預設插槽決定；位置、尺寸與收合狀態由呼叫端接上設定。
 */
const props = defineProps<{
  /** 面板識別碼（`toc`／`search`），同時給測試與「面板互相避讓」查詢用。 */
  panel: string;
  title: string;
  icon: IconName;
  /** 標題列的無障礙說明（含「可拖曳移動、方向鍵移動」等提示）。 */
  dragLabel: string;
  /** 縮放把手的無障礙說明。 */
  resizeLabel: string;
  /** 定位容器（檢視器根節點）。 */
  host: HTMLElement | null;
  collapsed: boolean;
  /** 開始時的記憶值。 */
  initialLayout: PanelLayout;
  /** 內容自然高度（呼叫端量自己的捲動區）。 */
  contentHeight: number;
  /** 未移動過時要避開的元素（同一窗格的其他浮動面板）。 */
  avoid?: () => HTMLElement | null;
}>();

const emit = defineEmits<{
  persist: [layout: PanelLayout];
  toggleCollapse: [];
}>();

const settings = useSettingsStore();

const { rect, panelStyle, moving, resizing, onTitlePointerDown, onTitleKeydown, onResizePointerDown, onResizeKeydown } =
  useViewerPanel({
    host: () => props.host,
    contentHeight: computed(() => props.contentHeight),
    collapsed: computed(() => props.collapsed),
    initialLayout: props.initialLayout,
    onPersist: (layout) => emit("persist", layout),
    onToggleCollapse: () => emit("toggleCollapse"),
    avoid: () => props.avoid?.() ?? null,
  });
</script>

<template>
  <div
    v-if="rect"
    :data-panel="panel"
    class="viewer-panel absolute z-30 flex flex-col overflow-hidden rounded-xl text-base"
    :class="{ 'is-active': moving || resizing }"
    :style="{ ...panelStyle, '--panel-opacity': `${settings.viewerPanelOpacity}%` }"
  >
    <div
      class="flex h-8 shrink-0 items-center gap-1 border-b px-2.5"
      :class="[!collapsed && 'border-line', moving ? 'cursor-grabbing' : 'cursor-grab']"
      tabindex="0"
      :aria-label="dragLabel"
      @pointerdown="onTitlePointerDown"
      @keydown="onTitleKeydown"
    >
      <AppIcon :name="icon" :size="14" class="text-ink-muted" />
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">{{ title }}</span>
      <button
        type="button"
        class="flex size-6 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        :title="collapsed ? `展開${title}` : `收合${title}`"
        :aria-expanded="!collapsed"
        @click="emit('toggleCollapse')"
      >
        <AppIcon :name="collapsed ? 'chevronDown' : 'chevronUp'" :size="14" />
      </button>
    </div>

    <div v-if="!collapsed" class="flex min-h-0 flex-1 flex-col">
      <slot />
    </div>

    <div
      v-if="!collapsed"
      class="absolute bottom-0 left-0 flex size-6 cursor-nesw-resize items-end justify-start pl-1 pb-1"
      :class="resizing ? 'text-accent' : 'text-ink-faint'"
      role="separator"
      :aria-label="resizeLabel"
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
 * 半透明底色 + 背景模糊：看得見底下的內文，但文字對比仍然足夠。
 * 不透明度由設定值餵進 `--panel-opacity`；系統要求減少透明度時改回不透明。
 *
 * 沒有滑鼠移過、鍵盤焦點也不在面板裡時，整塊幾乎隱形（也一起關掉模糊）：
 * 面板浮在內文上，平常不該擋住閱讀，只留一點淡淡的輪廓提醒它還在。
 * 移上去、焦點進入，或正在拖曳／縮放時才回到設定的材質。
 */
.viewer-panel {
  background: color-mix(in oklab, var(--color-menu) var(--panel-opacity, 50%), transparent);
  border: 1px solid var(--color-line);
  box-shadow:
    0 0 0 0.5px var(--color-hairline-bright) inset,
    0 12px 28px -8px oklch(0 0 0 / 0.28),
    0 2px 8px -2px oklch(0 0 0 / 0.18);
  backdrop-filter: blur(0);
  opacity: var(--panel-idle-opacity, 0.2);
  transition:
    opacity 160ms ease,
    backdrop-filter 160ms ease;
}

.viewer-panel:hover,
.viewer-panel:focus-within,
.viewer-panel.is-active {
  opacity: 1;
  /* 不透明度可以調到 50%，模糊要夠強才不會讓底下的文字穿過來干擾閱讀。 */
  backdrop-filter: blur(16px);
}

@media (prefers-reduced-transparency: reduce) {
  .viewer-panel {
    background: var(--color-menu);
    backdrop-filter: none;
  }
}
</style>
