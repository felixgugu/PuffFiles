<script setup lang="ts">
import { computed } from "vue";
import ErrorBanner from "@/components/common/ErrorBanner.vue";
import FileListView from "@/components/files/FileListView.vue";
import { useExplorerStore } from "@/stores/explorer";
import { useTabsStore } from "@/stores/tabs";
import type { PaneId } from "@/types/fs";

/**
 * 一個窗格＝一份檔案清單。
 *
 * 資料夾樹與路徑列已提升到分頁層級共用，所以這裡只負責清單本身，
 * 以及「我是不是焦點窗格」的視覺狀態。
 */
const props = defineProps<{ paneId: PaneId }>();

const explorer = useExplorerStore();
const tabs = useTabsStore();

const pane = computed(() => explorer.meta(props.paneId));
const active = computed(() => tabs.activePaneId === props.paneId);
</script>

<template>
  <section
    class="relative flex min-h-0 min-w-0 flex-1 flex-col bg-canvas"
    :class="active ? '' : 'pane-inactive'"
    @pointerdown="tabs.setActivePane(paneId)"
  >
    <ErrorBanner
      v-if="pane?.error"
      :error="pane.error"
      @dismiss="explorer.dismissError(paneId)"
      @retry="explorer.refresh(paneId)"
    />

    <FileListView :pane-id="paneId" />
  </section>
</template>
