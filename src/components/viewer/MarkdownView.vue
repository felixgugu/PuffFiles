<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, useTemplateRef, watch } from "vue";
import OutlinePanel from "./OutlinePanel.vue";
import ViewerSearchPanel from "./ViewerSearchPanel.vue";
import ViewerNotice from "./ViewerNotice.vue";
import { useMarkdownMermaid } from "@/composables/useMarkdownMermaid";
import { useMarkdownOutline } from "@/composables/useMarkdownOutline";
import { useMarkdownScrollSpy } from "@/composables/useMarkdownScrollSpy";
import { useLocalNavigation } from "@/composables/useLocalNavigation";
import { useViewerScroll } from "@/composables/useViewerScroll";
import { useExplorerStore } from "@/stores/explorer";
import { useSettingsStore } from "@/stores/settings";
import { useViewerStore } from "@/stores/viewer";
import { loadViewerBlobUrl } from "@/services/viewerResource";
import type { PaneId } from "@/types/fs";
import type { OutlineItem } from "@/types/viewer";
import { highlightCode, languageForToken, MAX_HIGHLIGHT_BYTES } from "@/utils/codeHighlight";
import { fileNameOf } from "@/utils/path";

/**
 * Markdown 內容。
 *
 * 渲染出來的 HTML 由 `utils/markdown.ts` 負責，這裡只做兩件與 DOM 有關的事：
 * 把本機相對圖片換成 blob URL，以及攔截連結點擊（外部連結交給系統、
 * 相對連結回到檔案清單導覽、`#錨點` 捲到對應標題）。
 */
const props = defineProps<{ paneId: PaneId }>();

const explorer = useExplorerStore();
const settings = useSettingsStore();
const viewer = useViewerStore();
const { openLocalTarget } = useLocalNavigation();

const state = computed(() => viewer.of(props.paneId));
const host = useTemplateRef<HTMLElement>("host");
const content = useTemplateRef<HTMLElement>("content");

/** 捲動位置：切換分頁再回來時要回到原本讀到的地方（見 `useViewerScroll`）。 */
const scroll = useViewerScroll(props.paneId, content);

/** Mermaid 圖表：內容進 DOM 後把 ```mermaid 區塊換成可切換圖表／原始碼的容器。 */
const mermaid = useMarkdownMermaid({
  root: () => content.value,
  path: () => state.value?.path ?? "",
});

/** 與標頭的目錄索引開關共用同一份渲染結果（同一個狀態只解析一次）。 */
const rendered = useMarkdownOutline(state);
const headings = computed(() => rendered.value.headings);
const { activeId, jumpTo } = useMarkdownScrollSpy(content, headings);
const tocVisible = computed(() => settings.markdownTocEnabled && headings.value.length > 0);
/** 目錄索引面板列的形狀（與 DOCX 的書籤目錄共用同一個面板元件）。 */
const tocItems = computed<OutlineItem[]>(() =>
  headings.value.map((heading) => ({ id: heading.id, text: heading.text, level: heading.level })),
);
const searchOpen = computed(() => state.value?.search.open === true);

/**
 * 檔案太大就跳過圍籬高亮。
 *
 * 只有真的有圍籬時才提示 —— 沒有程式碼區塊的長篇 Markdown 不該出現這一行。
 */
const skippedHighlight = computed(() => {
  const current = state.value;
  if (!current || current.size <= MAX_HIGHLIGHT_BYTES) {
    return false;
  }
  return /^ {0,3}(`{3,}|~{3,})/m.test(current.text);
});

/** 路徑 → blob URL；與畫面無關，所以不用響應式。 */
const blobs = new Map<string, string>();
const loading = new Set<string>();
let generation = 0;

function releaseBlobs() {
  for (const url of blobs.values()) {
    URL.revokeObjectURL(url);
  }
  blobs.clear();
  loading.clear();
}

/** 相對圖片一律走 IPC 讀取（與 HTML 預覽共用同一條），轉成 blob URL 後才交給 <img>。 */
async function loadImage(path: string): Promise<string> {
  const resource = await loadViewerBlobUrl(path);
  if (!resource) {
    throw new Error(`讀不到圖片內容：${fileNameOf(path) || path}`);
  }
  return resource.url;
}

function missingImage(path: string): HTMLElement {
  const placeholder = document.createElement("span");
  placeholder.className = "md-image-missing";
  placeholder.textContent = `無法顯示圖片：${fileNameOf(path) || path}`;
  return placeholder;
}

async function applyImages() {
  const root = content.value;
  if (!root) {
    return;
  }
  const current = generation;

  for (const image of root.querySelectorAll<HTMLImageElement>("img[data-viewer-image]")) {
    const path = image.dataset.viewerImage;
    if (!path) {
      continue;
    }
    const loaded = blobs.get(path);
    if (loaded) {
      image.src = loaded;
      continue;
    }
    if (loading.has(path)) {
      continue;
    }

    loading.add(path);
    try {
      const url = await loadImage(path);
      if (current !== generation) {
        URL.revokeObjectURL(url);
        return;
      }
      blobs.set(path, url);
      image.src = url;
    } catch {
      if (current === generation) {
        image.replaceWith(missingImage(path));
      }
    } finally {
      loading.delete(path);
    }
  }
}

/**
 * 把 ``` 區塊換成 highlight.js 的彩色版本。
 *
 * `renderMarkdown` 產出的是已經轉義過的字串，這裡讀回 `textContent`（等於原始程式碼）
 * 再交給 hljs；回傳的 HTML 同樣是轉義過的，所以直接寫回 `innerHTML` 是安全的。
 */
function applyCodeHighlight() {
  const root = content.value;
  if (!root || skippedHighlight.value) {
    return;
  }
  for (const code of root.querySelectorAll<HTMLElement>("pre.md-pre > code")) {
    const token = /language-([\w+#.-]+)/.exec(code.className)?.[1] ?? "";
    const language = languageForToken(token);
    if (!language) {
      continue;
    }
    const html = highlightCode(code.textContent ?? "", language);
    if (html !== null) {
      code.innerHTML = html;
    }
  }
}

watch(
  rendered,
  async () => {
    generation++;
    releaseBlobs();
    await nextTick();
    void applyImages();
    applyCodeHighlight();
    void mermaid.renderAll();
  },
  { immediate: true, flush: "post" },
);

/** 主題或「自動渲染 Mermaid」開關變動時重畫；換檔由上面的 rendered watcher 負責。 */
watch(
  [() => settings.isDark, () => settings.mermaidEnabled],
  () => {
    void mermaid.renderAll();
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  generation++;
  releaseBlobs();
});

/** 連結：外部交給系統開啟，相對路徑回到檔案清單導覽；Mermaid 面板按鈕優先處理。 */
function onClick(event: MouseEvent) {
  if (mermaid.handleClick(event)) {
    return;
  }
  const anchor = (event.target as HTMLElement | null)?.closest("a");
  if (!anchor) {
    return;
  }
  event.preventDefault();

  const external = anchor.dataset.viewerExternal;
  if (external) {
    void explorer.openPath(external);
    return;
  }

  const local = anchor.dataset.viewerLocal;
  if (local) {
    void openLocalTarget(props.paneId, local);
    return;
  }

  const fragment = anchor.dataset.viewerAnchor;
  if (fragment) {
    jumpTo(decodeFragment(fragment));
  }
}

/** 錨點可能是 URL 編碼過的中文；解不開就照原字串比對。 */
function decodeFragment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
</script>

<template>
  <div ref="host" class="relative flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
    <ViewerNotice v-if="skippedHighlight" text="檔案過大，已略過語法高亮" />
    <div
      ref="content"
      class="markdown code-highlight scroll-area isolate min-h-0 flex-1 overflow-auto bg-canvas px-6 py-5 select-text"
      @click="onClick"
      @scroll.passive="scroll.save"
      v-html="rendered.html"
    />
    <OutlinePanel
      v-if="tocVisible"
      :key="state?.path"
      :pane-id="paneId"
      title="目錄索引"
      :items="tocItems"
      :active-id="activeId"
      :host="host"
      @jump="jumpTo"
    />
    <ViewerSearchPanel
      v-if="searchOpen"
      :key="state?.path"
      :pane-id="paneId"
      :host="host"
      :root="content"
      :source="rendered.html"
    />
  </div>
</template>

<style scoped>
/*
 * `v-html` 的內容不會經過 Tailwind 掃描，也不吃 scoped 的屬性選擇器，
 * 所以樣式用 :deep() 搭配既有的設計權杖寫成一般 CSS。
 */
.markdown {
  color: var(--color-ink);
  font-size: 0.95rem;
  line-height: 1.75;
  overflow-wrap: anywhere;
}

.markdown :deep(> :first-child) {
  margin-top: 0;
}

.markdown :deep(> :last-child) {
  margin-bottom: 0;
}

.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3),
.markdown :deep(h4),
.markdown :deep(h5),
.markdown :deep(h6) {
  margin: 1.6em 0 0.6em;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
}

.markdown :deep(h1) {
  font-size: 1.6rem;
  border-bottom: 1px solid var(--color-line);
  padding-bottom: 0.3em;
}

.markdown :deep(h2) {
  font-size: 1.3rem;
  border-bottom: 1px solid var(--color-line);
  padding-bottom: 0.25em;
}

.markdown :deep(h3) {
  font-size: 1.12rem;
}

.markdown :deep(h4),
.markdown :deep(h5),
.markdown :deep(h6) {
  font-size: 1rem;
}

.markdown :deep(p) {
  margin: 0.75em 0;
}

.markdown :deep(a.md-link) {
  color: var(--color-accent);
  text-decoration: none;
  border-bottom: 1px solid color-mix(in oklab, var(--color-accent) 40%, transparent);
}

.markdown :deep(a.md-link:hover) {
  border-bottom-color: var(--color-accent);
}

.markdown :deep(.md-code) {
  border-radius: 4px;
  background: var(--color-surface-muted);
  padding: 0.1em 0.35em;
  font-family: var(--font-mono, ui-monospace, "Cascadia Mono", Consolas, monospace);
  font-size: 0.88em;
}

.markdown :deep(.md-pre) {
  margin: 0.9em 0;
  overflow-x: auto;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface-muted);
  padding: 0.75rem 0.9rem;
}

.markdown :deep(.md-pre code) {
  font-family: var(--font-mono, ui-monospace, "Cascadia Mono", Consolas, monospace);
  font-size: 0.86rem;
  line-height: 1.6;
  white-space: pre;
}

.markdown :deep(.md-quote) {
  margin: 0.9em 0;
  border-left: 3px solid var(--color-line-strong);
  padding: 0.1em 0 0.1em 0.9em;
  color: var(--color-ink-muted);
}

.markdown :deep(.md-list) {
  margin: 0.75em 0;
  padding-left: 1.5em;
}

.markdown :deep(.md-list li) {
  margin: 0.25em 0;
}

.markdown :deep(ul.md-list) {
  list-style: disc;
}

.markdown :deep(ol.md-list) {
  list-style: decimal;
}

.markdown :deep(.md-table) {
  margin: 0.9em 0;
  border-collapse: collapse;
  width: 100%;
  font-size: 0.92em;
}

.markdown :deep(.md-table th),
.markdown :deep(.md-table td) {
  border: 1px solid var(--color-line);
  padding: 0.35em 0.6em;
}

.markdown :deep(.md-table th) {
  background: var(--color-surface-muted);
  font-weight: 600;
}

.markdown :deep(.md-image) {
  max-width: 100%;
  border-radius: 6px;
}

.markdown :deep(.md-image-missing) {
  display: inline-block;
  border: 1px dashed var(--color-line-strong);
  border-radius: 6px;
  padding: 0.4em 0.7em;
  color: var(--color-ink-faint);
  font-size: 0.9em;
}

.markdown :deep(.md-warning) {
  margin: 0 0 0.75em;
  border-left: 3px solid var(--color-danger);
  background: var(--color-danger-soft);
  padding: 0.5em 0.75em;
  color: var(--color-ink);
  font-size: 0.9em;
}

.markdown :deep(hr) {
  margin: 1.6em 0;
  border: none;
  border-top: 1px solid var(--color-line);
}

/* Mermaid 圖表容器：標題列（可切換）＋圖表／原始碼。 */
.markdown :deep(.md-mermaid) {
  margin: 0.9em 0;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface-muted);
}

.markdown :deep(.md-mermaid-bar) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem 0.3rem 0.7rem;
  border-bottom: 1px solid var(--color-line);
  color: var(--color-ink-muted);
  font-size: 0.78rem;
}

.markdown :deep(.md-mermaid-title) {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.markdown :deep(.md-mermaid-actions) {
  display: flex;
  gap: 0.25rem;
}

.markdown :deep(.md-mermaid-action) {
  border-radius: 5px;
  padding: 0.15rem 0.45rem;
  color: var(--color-ink-muted);
  font-size: 0.78rem;
  cursor: pointer;
}

.markdown :deep(.md-mermaid-action:hover) {
  background: var(--color-surface-hover);
  color: var(--color-ink);
}

.markdown :deep(.md-mermaid-action:active) {
  background: var(--color-pressed);
}

.markdown :deep(.md-mermaid-view) {
  overflow: auto;
  padding: 0.9rem;
}

/*
 * 圖表一律以 mermaid 算出的自然尺寸呈現（`useMarkdownMermaid` 把 SVG 的 `width`／
 * `height` 寫成 viewBox 的內在尺寸、並移除 inline `max-width`）：**不隨窗格縮放**，
 * 靠左對齊與內文排版維持一致，比容器寬時交由上面的 `overflow: auto` 產生水平捲軸。
 * SVG 的 viewBox 保持 mermaid 原樣（不可歸零成 `0 0 w h`，那會把視窗往右下推而裁掉
 * 圖表的右緣與下緣）。
 */
.markdown :deep(.md-mermaid-view svg) {
  display: block;
  margin: 0;
  font-size: 12px!important;
}

.markdown :deep(.md-mermaid-message) {
  color: var(--color-ink-faint);
  font-size: 0.85em;
}

/* 顯示圖表時，原始碼那塊交給容器隱藏（[hidden] 由瀏覽器處理 display）。 */
.markdown :deep(.md-mermaid-source) {
  margin: 0;
  border: none;
  border-radius: 0;
  background: transparent;
}

/* 這裡的 display 是自訂的，會蓋過 [hidden] 的 UA 樣式，所以補一條明確規則。 */
.markdown :deep(.md-mermaid-view[hidden]),
.markdown :deep(.md-mermaid-source[hidden]) {
  display: none;
}
</style>
