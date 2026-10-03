<script setup lang="ts">
import { onBeforeUnmount, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import HistoryPanel from "@/components/overlays/HistoryPanel.vue";
import { useUiStore } from "@/stores/ui";

const ui = useUiStore();
const root = useTemplateRef<HTMLElement>("root");

/** 開設定時順手收起紀錄選單，兩個浮層不要疊在一起。 */
function toggleSettings() {
  ui.historyOpen = false;
  ui.settingsOpen = !ui.settingsOpen;
}

/**
 * 點擊選單以外的區域就關閉。
 *
 * 判斷範圍包含觸發按鈕本身 —— 否則 pointerdown 會先關掉、按鈕的 click 又把它打開，
 * 變成怎麼點都關不掉。按鈕的開關交給它自己的 click 處理。
 */
function onWindowPointerDown(event: PointerEvent) {
  const target = event.target;
  if (target instanceof Node && root.value?.contains(target)) {
    return;
  }
  ui.historyOpen = false;
}

watch(
  () => ui.historyOpen,
  (open) => {
    if (open) {
      window.addEventListener("pointerdown", onWindowPointerDown, true);
    } else {
      window.removeEventListener("pointerdown", onWindowPointerDown, true);
    }
  },
);

onBeforeUnmount(() => window.removeEventListener("pointerdown", onWindowPointerDown, true));
</script>

<template>
  <div ref="root" class="relative flex shrink-0 items-center gap-0.5 self-stretch" data-tauri-drag-region>
    <button
      type="button"
      class="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors duration-100"
      :class="ui.historyOpen ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:bg-surface-hover hover:text-ink'"
      title="資料夾瀏覽紀錄"
      @click="ui.historyOpen = !ui.historyOpen"
    >
      <AppIcon name="history" :size="14" />
      紀錄
    </button>
    <button
      type="button"
      class="flex size-7 items-center justify-center rounded-md transition-colors duration-100"
      :class="ui.settingsOpen ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:bg-surface-hover hover:text-ink'"
      title="設定"
      @click="toggleSettings()"
    >
      <AppIcon name="settings" :size="15" />
    </button>

    <HistoryPanel />
  </div>
</template>
