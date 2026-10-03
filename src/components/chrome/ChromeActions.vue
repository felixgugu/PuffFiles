<script setup lang="ts">
import AppIcon from "@/components/common/AppIcon.vue";
import HistoryPanel from "@/components/overlays/HistoryPanel.vue";
import { useUiStore } from "@/stores/ui";

const ui = useUiStore();
</script>

<template>
  <div class="relative flex shrink-0 items-center gap-0.5 self-stretch" data-tauri-drag-region>
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
      @click="ui.settingsOpen = !ui.settingsOpen"
    >
      <AppIcon name="settings" :size="15" />
    </button>

    <HistoryPanel />
  </div>
</template>
