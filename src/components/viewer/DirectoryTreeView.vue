<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import ViewerNotice from "./ViewerNotice.vue";
import { useViewerScroll } from "@/composables/useViewerScroll";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import { formatCount } from "@/utils/format";
import { DIRECTORY_TREE_LIMIT } from "@/utils/viewer";

/**
 * ASCII 目錄樹狀檢視器。
 *
 * 內容是後端一次產生的純文字；切換 Unicode／ASCII 只換字串，不會重掃磁碟。
 * 保留空白與水平捲動，避免長路徑或深層結構被自動換行破壞。
 */
const props = defineProps<{ paneId: PaneId }>();

const viewer = useViewerStore();
const state = computed(() => viewer.of(props.paneId));
const pre = useTemplateRef<HTMLElement>("pre");
const scroll = useViewerScroll(props.paneId, pre);

const notice = computed(() => {
  const tree = state.value?.tree;
  if (!tree) {
    return "";
  }
  const parts: string[] = [];
  if (tree.truncated) {
    parts.push(`已達 ${formatCount(DIRECTORY_TREE_LIMIT)} 個節點上限，目錄樹只顯示前段內容`);
  }
  if (tree.skipped > 0) {
    parts.push(`有 ${tree.skipped} 個資料夾無法讀取，已略過`);
  }
  return parts.join("；");
});
</script>

<template>
  <div class="relative flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
    <ViewerNotice v-if="notice" :text="notice" />
    <pre
      ref="pre"
      class="scroll-area isolate min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-sm leading-6 whitespace-pre text-ink select-text"
      @scroll.passive="scroll.save"
    >{{ state?.text }}</pre>
  </div>
</template>
