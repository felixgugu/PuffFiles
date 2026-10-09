<script setup lang="ts">
import { computed } from "vue";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";

/**
 * PDF 檢視器：把自訂協定（`stream`）的 URL 直接交給 WebView2 內建的 PDF viewer。
 *
 * 內容不經過 IPC，也不是 base64／Blob：後端只在使用者需要某一段時送出那一段
 * （HTTP Range），所以記憶體不會隨檔案大小膨脹。翻頁、縮放、旋轉、列印與文字選取
 * 都由 WebView2 自己的工具列提供。
 *
 * 刻意**不加 `sandbox`**：PDF viewer 需要自己的 UI 與右鍵選單。iframe 是獨立的
 * document，`main.ts` 的全域右鍵攔截不會影響它，所以那裡的選單維持原生行為。
 */
const props = defineProps<{ paneId: PaneId }>();

const viewer = useViewerStore();
const state = computed(() => viewer.of(props.paneId));
</script>

<template>
  <iframe
    v-if="state?.streamUrl"
    :src="state.streamUrl"
    :title="state.name"
    class="min-h-0 w-full flex-1 border-0 bg-canvas"
  />
</template>
