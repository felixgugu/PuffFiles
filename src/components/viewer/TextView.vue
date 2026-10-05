<script setup lang="ts">
import { computed } from "vue";
import ViewerNotice from "./ViewerNotice.vue";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import { highlightCode, languageForPath, MAX_HIGHLIGHT_BYTES } from "@/utils/codeHighlight";
import { fileKindOf } from "@/utils/fileKind";
import { extensionOf } from "@/utils/path";

/**
 * 純文字內容：等寬、自動換行、不顯示行號。
 *
 * 程式碼檔（`fileKind.ts` 的「程式碼」類）會多一層語法高亮；超過
 * `MAX_HIGHLIGHT_BYTES` 就整份當純文字，避免同步高亮卡住 UI。
 * 內容區帶著 `data-native-menu`，讓原生右鍵選單與 Ctrl+C 複製文字可用。
 */
const props = defineProps<{ paneId: PaneId }>();

const viewer = useViewerStore();
const state = computed(() => viewer.of(props.paneId));

/**
 * 只有「程式碼」類的檔案要上色；純文字（.txt／.log…）維持原樣。
 *
 * 檢視器的 kind 只有 markdown／html／image／text，檔案是不是程式碼要看
 * `fileKind.ts`；HTML 的「原始碼模式」也是純文字，但路徑是 .html，要一起高亮。
 */
const language = computed(() => {
  const current = state.value;
  if (!current) {
    return null;
  }
  if (current.kind === "html") {
    return languageForPath(current.path);
  }
  if (current.kind !== "text") {
    return null;
  }
  const extension = extensionOf(current.path).replace(/^\./, "");
  const kind = fileKindOf({ isDir: false, extension: extension || null });
  return kind === "code" ? languageForPath(current.path) : null;
});

/** 超過門檻就不高亮；`null` 代表直接輸出原始文字。 */
const tooLarge = computed(
  () => language.value !== null && (state.value?.size ?? 0) > MAX_HIGHLIGHT_BYTES,
);

const highlighted = computed(() => {
  if (tooLarge.value || !language.value) {
    return null;
  }
  return highlightCode(state.value?.text ?? "", language.value);
});

const notice = computed(() =>
  tooLarge.value ? "檔案過大，已略過語法高亮" : "",
);
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
    <ViewerNotice v-if="notice" :text="notice" />
    <pre
      v-if="highlighted === null"
      data-native-menu
      class="scroll-area min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-sm leading-6 break-words whitespace-pre-wrap text-ink"
    >{{ state?.text ?? "" }}</pre>
    <!--
      高亮結果由 highlight.js 產生，原始碼裡的 `<`／`&` 都已轉義，v-html 沒有注入風險。
    -->
    <pre
      v-else
      data-native-menu
      class="code-highlight scroll-area min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-sm leading-6 break-words whitespace-pre-wrap text-ink"
      v-html="highlighted"
    />
  </div>
</template>
