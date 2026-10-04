<script setup lang="ts">
import { computed } from "vue";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";

/**
 * 純文字內容：等寬、自動換行、不顯示行號。
 *
 * 內容區帶著 `data-native-menu`，讓原生右鍵選單與 Ctrl+C 複製文字可用。
 */
const props = defineProps<{ paneId: PaneId }>();

const viewer = useViewerStore();
const state = computed(() => viewer.of(props.paneId));
</script>

<template>
  <div data-native-menu class="scroll-area min-h-0 flex-1 overflow-auto bg-canvas px-4 py-3">
    <pre
      class="font-mono text-sm leading-6 whitespace-pre-wrap break-words text-ink"
    >{{ state?.text ?? "" }}</pre>
  </div>
</template>
