<script setup lang="ts">
import { computed } from "vue";
import ErrorBanner from "@/components/common/ErrorBanner.vue";
import FileListView from "@/components/files/FileListView.vue";
import ViewerPane from "@/components/viewer/ViewerPane.vue";
import { useExplorerStore } from "@/stores/explorer";
import { useTabsStore } from "@/stores/tabs";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";

/**
 * 一個窗格＝一份檔案清單，或一個檢視器（暫時疊在同一塊版面上）。
 *
 * 資料夾樹與路徑列已提升到分頁層級共用，所以這裡只負責清單本身，
 * 以及「我是不是焦點窗格」的視覺狀態。
 */
const props = defineProps<{ paneId: PaneId }>();

const explorer = useExplorerStore();
const tabs = useTabsStore();
const viewer = useViewerStore();

const pane = computed(() => explorer.meta(props.paneId));
const active = computed(() => tabs.activePaneId === props.paneId);
const viewing = computed(() => viewer.of(props.paneId));
</script>

<template>
  <!--
    檢視器窗格不套用 `pane-inactive`：它是「旁邊的顯示區」，不是待使用的清單，
    淡化只會讓內容更難讀。那套淡化樣式是給沒有焦點的檔案清單用的。
  -->
  <section
    class="relative flex min-h-0 min-w-0 flex-1 flex-col bg-canvas"
    :class="active || viewing ? '' : 'pane-inactive'"
    @pointerdown="tabs.setActivePane(paneId)"
  >
    <ErrorBanner
      v-if="!viewing && pane?.error"
      :error="pane.error"
      @dismiss="explorer.dismissError(paneId)"
      @retry="explorer.refresh(paneId)"
    />

    <!--
      清單刻意用 v-show 留在 DOM 裡：檢視器關掉時捲動位置與虛擬滾動狀態都還在，
      不會像重新掛載那樣跳回最上面。
    -->
    <FileListView v-show="!viewing" :pane-id="paneId" />
    <ViewerPane v-if="viewing" :pane-id="paneId" />
  </section>
</template>
