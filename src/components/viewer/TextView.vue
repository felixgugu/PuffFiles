<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import BookmarkOutline from "./BookmarkOutline.vue";
import ViewerNotice from "./ViewerNotice.vue";
import ViewerSearchPanel from "./ViewerSearchPanel.vue";
import { useViewerBookmarks } from "@/composables/useViewerBookmarks";
import { useViewerScroll } from "@/composables/useViewerScroll";
import { useSettingsStore } from "@/stores/settings";
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
 * 內文可以選取（`select-text`）並用 Ctrl+C 複製；這裡**不**掛 `data-native-menu`，
 * 檢視器內文不提供原生右鍵選單（見 `main.ts` 的攔截）。
 */
const props = defineProps<{ paneId: PaneId }>();

const viewer = useViewerStore();
const settings = useSettingsStore();
const state = computed(() => viewer.of(props.paneId));
const host = useTemplateRef<HTMLElement>("host");
const pre = useTemplateRef<HTMLElement>("pre");

/** 捲動位置：切換分頁再回來時要回到原本讀到的地方（見 `useViewerScroll`）。 */
const scroll = useViewerScroll(props.paneId, pre);

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

/**
 * 書籤目錄：純文字與程式碼沒有大綱，目錄由使用者自己選取文字累積。
 *
 * 這一種內容的捲動容器與內容根節點是同一個 `<pre>`，文字來源就是 store 裡的
 * `state.text`（與畫面上一模一樣，不用整份複製 DOM 文字）。
 */
const {
  enabled: bookmarksEnabled,
  panelItems: bookmarkItems,
  activeId: bookmarkActiveId,
  canAdd: canAddBookmark,
  jumpTo: jumpToBookmark,
  addFromSelection,
  rename: renameBookmark,
  remove: removeBookmark,
} = useViewerBookmarks({
  paneId: props.paneId,
  kind: () => state.value?.kind ?? null,
  host: () => host.value,
  viewport: () => pre.value,
  content: () => pre.value,
  text: () => state.value?.text ?? "",
  size: () => state.value?.size ?? 0,
  revision: () => state.value?.text ?? "",
  path: () => state.value?.path ?? "",
});

const bookmarkPanel = computed(
  () => settings.viewerBookmarksEnabled && bookmarksEnabled.value,
);
</script>

<template>
  <div ref="host" class="relative flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
    <ViewerNotice v-if="notice" :text="notice" />
    <pre
      v-if="highlighted === null"
      ref="pre"
      class="scroll-area isolate min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-sm leading-6 break-words whitespace-pre-wrap text-ink select-text"
      @scroll.passive="scroll.save"
      v-html="escapedText"
    />
    <!--
      高亮結果由 highlight.js 產生，原始碼裡的 `<`／`&` 都已轉義，v-html 沒有注入風險。
    -->
    <pre
      v-else
      ref="pre"
      class="code-highlight scroll-area isolate min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-sm leading-6 break-words whitespace-pre-wrap text-ink select-text"
      @scroll.passive="scroll.save"
      v-html="highlighted"
    />

    <BookmarkOutline
      v-if="bookmarkPanel"
      :key="state?.path"
      :pane-id="paneId"
      :host="host"
      :items="bookmarkItems"
      :active-id="bookmarkActiveId"
      :can-add="canAddBookmark"
      @jump="jumpToBookmark"
      @rename="renameBookmark"
      @remove="removeBookmark"
      @add="addFromSelection"
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
