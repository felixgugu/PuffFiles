<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import ErrorBanner from "@/components/common/ErrorBanner.vue";
import HtmlView from "./HtmlView.vue";
import ImageView from "./ImageView.vue";
import MarkdownView from "./MarkdownView.vue";
import TextView from "./TextView.vue";
import { useMarkdownOutline } from "@/composables/useMarkdownOutline";
import { useExplorerStore } from "@/stores/explorer";
import { useSettingsStore } from "@/stores/settings";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import { formatBytes } from "@/utils/format";
import { colorFor, iconFor } from "@/utils/fileKind";
import { tocPanelFits } from "@/utils/markdownToc";

/**
 * 檢視器窗格：標頭（檔名＋動作）＋內容。
 *
 * 只負責呈現與分派；讀檔、快取與自動重載都在 `stores/viewer.ts`。
 */
const props = defineProps<{ paneId: PaneId }>();

const explorer = useExplorerStore();
const settings = useSettingsStore();
const viewer = useViewerStore();

const state = computed(() => viewer.of(props.paneId));

/*
 * 目錄索引開關：只有 Markdown 出現，預設開啟。
 *
 * 沒有 h1～h6、或窗格窄到放不下最小寬度的面板時，開關維持可見但反灰停用、
 * 並呈現關閉狀態 —— 使用者才看得出「這個功能現在不能用」，而不是按了沒反應。
 */
const outline = useMarkdownOutline(state);
const root = useTemplateRef<HTMLElement>("root");
const paneWidth = ref(0);
let observer: ResizeObserver | null = null;

onMounted(() => {
  const element = root.value;
  if (!element) {
    return;
  }
  paneWidth.value = element.clientWidth;
  observer = new ResizeObserver(() => {
    paneWidth.value = element.clientWidth;
  });
  observer.observe(element);
});

onBeforeUnmount(() => observer?.disconnect());

const tocAvailable = computed(
  () =>
    state.value?.kind === "markdown" &&
    outline.value.headings.length > 0 &&
    tocPanelFits(paneWidth.value, settings.markdownTocMinWidth),
);
const tocOn = computed(() => tocAvailable.value && settings.markdownTocEnabled);
const tocTitle = computed(() => {
  if (!outline.value.headings.length) {
    return "這份文件沒有標題";
  }
  if (!tocPanelFits(paneWidth.value, settings.markdownTocMinWidth)) {
    return "窗格太窄，目錄索引已隱藏";
  }
  return settings.markdownTocEnabled ? "目錄索引（開啟）" : "目錄索引（關閉）";
});

const extension = computed(() => extensionOf(state.value?.path ?? ""));

/** 只有 HTML 有兩種顯示模式；切換鈕也只對它出現。 */
const isHtml = computed(() => state.value?.kind === "html");
const previewing = computed(() => isHtml.value && state.value?.mode === "preview");

const icon = computed(() =>
  iconFor({ isDir: false, isSymlink: false, extension: extension.value }),
);
const color = computed(() => colorFor({ isDir: false, extension: extension.value }));

const detail = computed(() => {
  const current = state.value;
  if (!current) {
    return "";
  }
  const parts: string[] = [];
  if (current.size > 0) {
    parts.push(formatBytes(current.size));
  }
  if (current.encoding) {
    parts.push(current.encoding);
  }
  return parts.join(" · ");
});

function extensionOf(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? "";
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1) : null;
}

function openWithDefault() {
  const current = state.value;
  if (current) {
    void explorer.openPath(current.path);
  }
}

function toggleMode() {
  const current = state.value;
  if (!current || current.kind !== "html") {
    return;
  }
  viewer.setMode(props.paneId, current.mode === "preview" ? "source" : "preview");
}

function reveal() {
  const current = state.value;
  if (current) {
    void explorer.revealTarget(current.path);
  }
}
</script>

<template>
  <div ref="root" v-if="state" class="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
    <header
      class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 text-base"
    >
      <AppIcon :name="icon" :size="15" :class="color" class="shrink-0" />
      <span class="min-w-0 truncate font-medium" :title="state.path">{{ state.name }}</span>
      <span v-if="state.status === 'loading'" class="shrink-0 text-sm text-ink-faint">
        正在載入…
      </span>
      <span v-else-if="detail" class="min-w-0 truncate text-xs text-ink-faint">{{ detail }}</span>

      <div class="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          v-if="state.kind === 'markdown'"
          type="button"
          class="flex size-7 items-center justify-center rounded-md pressable disabled:opacity-30"
          :class="
            tocOn
              ? 'bg-accent-soft text-accent'
              : 'text-ink-muted enabled:hover:bg-surface-hover enabled:active:bg-pressed enabled:hover:text-ink'
          "
          :aria-pressed="tocOn"
          :disabled="!tocAvailable"
          :title="tocTitle"
          @click="settings.toggleMarkdownToc()"
        >
          <AppIcon name="toc" :size="15" />
        </button>
        <button
          v-if="isHtml"
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
          :title="previewing ? '看原始碼' : '看預覽'"
          @click="toggleMode"
        >
          <AppIcon :name="previewing ? 'code' : 'eye'" :size="15" />
        </button>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
          title="用預設程式開啟"
          @click="openWithDefault"
        >
          <AppIcon name="externalLink" :size="15" />
        </button>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
          title="在檔案總管中顯示"
          @click="reveal"
        >
          <AppIcon name="folderOpen" :size="15" />
        </button>
        <button
          v-if="state.kind !== null"
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
          title="重新整理 (F5)"
          @click="viewer.reload(paneId)"
        >
          <AppIcon name="refresh" :size="15" />
        </button>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
          title="關閉檢視器 (Esc)"
          @click="viewer.close(paneId)"
        >
          <AppIcon name="close" :size="15" />
        </button>
      </div>
    </header>

    <ErrorBanner
      v-if="state.error"
      :error="state.error"
      @dismiss="viewer.close(paneId)"
      @retry="viewer.reload(paneId)"
    />

    <div
      v-else-if="state.status === 'loading'"
      class="flex min-h-0 flex-1 items-center justify-center text-sm text-ink-faint"
    >
      正在讀取…
    </div>

    <div
      v-else-if="state.kind === null"
      class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <AppIcon name="info" :size="22" class="text-ink-faint" />
      <p class="text-sm text-ink-muted">這個檔案類型還沒有檢視器</p>
    </div>

    <MarkdownView v-else-if="state.kind === 'markdown'" :pane-id="paneId" />
    <HtmlView v-else-if="state.kind === 'html' && state.mode === 'preview'" :pane-id="paneId" />
    <ImageView v-else-if="state.kind === 'image'" :pane-id="paneId" />
    <TextView v-else :pane-id="paneId" />
  </div>
</template>
