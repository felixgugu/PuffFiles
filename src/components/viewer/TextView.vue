<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import ViewerNotice from "./ViewerNotice.vue";
import ViewerSearchPanel from "./ViewerSearchPanel.vue";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import { highlightCode, languageForPath, MAX_HIGHLIGHT_BYTES } from "@/utils/codeHighlight";
import { fileKindOf } from "@/utils/fileKind";
import { escapeHtml } from "@/utils/markdown";
import { extensionOf } from "@/utils/path";
import { supportsViewerSearch } from "@/utils/viewer";

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
const host = useTemplateRef<HTMLElement>("host");
const pre = useTemplateRef<HTMLElement>("pre");

/** 搜尋面板：純文字與程式碼都有（HTML 的原始碼模式也走這裡）。 */
const searchOpen = computed(
  () => state.value?.search.open === true && supportsViewerSearch(state.value?.kind ?? null),
);

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

const notice = computed(() => (tooLarge.value ? "檔案過大，已略過語法高亮" : ""));

/**
 * 沒有語法高亮時改用 `v-html` 輸出轉義後的文字。
 *
 * 搜尋會在文字節點裡插入 `<mark>`；用 `{{ }}` 內插的話那個文字節點歸 Vue 管，
 * 標記會讓 Vue 的節點參照失效。改成 `v-html` 之後整段內容由 Vue 換掉，標記
 * 自然被丟棄，搜尋要還原也只要清掉標記就好。
 */
const escapedText = computed(() => escapeHtml(state.value?.text ?? ""));
</script>

<template>
  <div ref="host" class="relative flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
    <ViewerNotice v-if="notice" :text="notice" />
    <pre
      v-if="highlighted === null"
      ref="pre"
      data-native-menu
      class="scroll-area min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-sm leading-6 break-words whitespace-pre-wrap text-ink"
      v-html="escapedText"
    />
    <!--
      高亮結果由 highlight.js 產生，原始碼裡的 `<`／`&` 都已轉義，v-html 沒有注入風險。
    -->
    <pre
      v-else
      ref="pre"
      data-native-menu
      class="code-highlight scroll-area min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-sm leading-6 break-words whitespace-pre-wrap text-ink"
      v-html="highlighted"
    />

    <ViewerSearchPanel
      v-if="searchOpen"
      :key="state?.path"
      :pane-id="paneId"
      :host="host"
      :root="pre"
      :source="state?.text ?? ''"
      show-line
    />
  </div>
</template>
