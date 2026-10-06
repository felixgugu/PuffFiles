<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import ViewerNotice from "./ViewerNotice.vue";
import ViewerSearchPanel from "./ViewerSearchPanel.vue";
import { useLocalNavigation } from "@/composables/useLocalNavigation";
import { useExplorerStore } from "@/stores/explorer";
import { useViewerStore } from "@/stores/viewer";
import { loadViewerBlobUrl, loadViewerText } from "@/services/viewerResource";
import type { PaneId } from "@/types/fs";
import {
  collectCssReferences,
  DEFERRED_HREF_ATTRIBUTE,
  DEFERRED_SRC_ATTRIBUTE,
  DEFERRED_SRCSET_ATTRIBUTE,
  joinSrcset,
  referenceKind,
  replaceMissingImage,
  rewriteCssReferences,
  sanitizeHtml,
  splitReference,
  splitSrcset,
  type SrcsetCandidate,
} from "@/utils/html";
import { parentOf, resolveLocalPath } from "@/utils/path";
import { supportsViewerSearch } from "@/utils/viewer";

/**
 * HTML 靜態預覽：`iframe[srcdoc]` ＋ 本機資源改寫。
 *
 * 安全性靠兩層：`sandbox` 不給 `allow-scripts`，所以框內的頁面永遠不會執行任何
 * 腳本；`utils/html.ts` 再把 `<script>`、`on*`、`<base>` 與 meta refresh 拿掉，
 * 讓 DOM 本身就是靜態的。`allow-same-origin` 是必要的 —— 只有同源，父層才能進入
 * `contentDocument` 把相對資源換成 blob URL，並攔截連結與鍵盤。
 *
 * 遠端資源一律不載入（不連外、不洩漏開了哪個檔），需要 JS 的頁面只會看到靜態骨架，
 * 兩者都會在提示條說明。
 */
const props = defineProps<{ paneId: PaneId }>();

const explorer = useExplorerStore();
const viewer = useViewerStore();
const { openLocalTarget } = useLocalNavigation();

/** 巢狀 `@import` 的深度上限；同時做為防環的第二道保險（第一道是路徑去重）。 */
const MAX_IMPORT_DEPTH = 5;

const state = computed(() => viewer.of(props.paneId));
const baseDir = computed(() => parentOf(state.value?.path ?? "") ?? "");
const sanitized = computed(() => sanitizeHtml(state.value?.text ?? ""));

const frame = useTemplateRef<HTMLIFrameElement>("frame");
const host = useTemplateRef<HTMLElement>("host");
/** `null`＝樣式前置處理還沒完成；有值就是可以放進 iframe 的完整文件。 */
const preparedHtml = ref<string | null>(null);
const skipped = ref(0);
/** iframe 每次載入完成就 +1，讓搜尋知道「現在這份 body 才是新的」。 */
const frameReady = ref(0);

const searchOpen = computed(
  () => state.value?.search.open === true && supportsViewerSearch(state.value?.kind ?? null),
);

/** 預覽文件的 body；`frameReady` 變動時重算，搜尋才不會抓著上一份文件。 */
const frameBody = computed(() => {
  if (!frameReady.value) {
    return null;
  }
  return frame.value?.contentDocument?.body ?? null;
});

/** 這個世代建立的所有 blob URL；換檔案、關閉或卸載時一次撤銷。 */
const blobUrls = new Set<string>();
let generation = 0;

const notice = computed(() => {
  const hasScript = sanitized.value.hasScript;
  const count = skipped.value;
  if (hasScript && count > 0) {
    return `預覽為靜態模式：不執行 JavaScript，另有 ${count} 個外部或未支援的資源未載入。`;
  }
  if (hasScript) {
    return "預覽為靜態模式：頁面的 JavaScript 不會執行，內容可能不完整。";
  }
  if (count > 0) {
    return `預覽為靜態模式：有 ${count} 個外部或未支援的資源未載入。`;
  }
  return "";
});

interface LoadedResource {
  /** 要寫進 DOM 的值：blob URL 接回原本的 `#fragment`。 */
  value: string;
  /** 建立出來的 blob URL，世代被換掉時要單獨撤銷。 */
  blob: string;
}

interface CssLoad {
  url: string;
  skipped: number;
}

function createBlobUrl(content: string, type: string): string {
  const url = URL.createObjectURL(new Blob([content], { type }));
  blobUrls.add(url);
  return url;
}

function revokeBlob(url: string) {
  URL.revokeObjectURL(url);
  blobUrls.delete(url);
}

function releaseBlobs() {
  for (const url of blobUrls) {
    URL.revokeObjectURL(url);
  }
  blobUrls.clear();
}

/** 把參考值解析成本機絕對路徑；不是本機檔案或解析不出來時回 `null`。 */
function localTarget(reference: string, directory: string): string | null {
  if (referenceKind(reference) !== "local") {
    return null;
  }
  const path = resolveLocalPath(directory, splitReference(reference).target);
  return path || null;
}

function isStyleSheetPath(path: string): boolean {
  return /\.css$/i.test(path);
}

/** 讀一個本機二進位資源（圖片、字型…）成可以放進 DOM 的 blob URL。 */
async function loadResource(reference: string, directory: string): Promise<LoadedResource | null> {
  const target = localTarget(reference, directory);
  if (!target) {
    return null;
  }
  const resource = await loadViewerBlobUrl(target);
  if (!resource) {
    return null;
  }
  blobUrls.add(resource.url);
  return { value: resource.url + splitReference(reference).suffix, blob: resource.url };
}

/** 讀一份 CSS、遞迴改寫它自己的位址，回傳可直接放進 `<link href>` 的 blob URL。 */
async function loadStyleSheet(
  reference: string,
  directory: string,
  seen: Set<string>,
  depth: number,
): Promise<CssLoad | null> {
  if (depth >= MAX_IMPORT_DEPTH) {
    return null;
  }
  const target = localTarget(reference, directory);
  if (!target) {
    return null;
  }
  const key = target.toLocaleLowerCase();
  if (seen.has(key)) {
    return null;
  }
  seen.add(key);

  const text = await loadViewerText(target);
  if (text === null) {
    return null;
  }

  // `url()` 在外部 CSS 裡是相對於那份 CSS 自己的資料夾，不是引用它的 HTML。
  const rewritten = await rewriteCss(text, parentOf(target) ?? directory, seen, depth + 1);
  return { url: createBlobUrl(rewritten.css, "text/css"), skipped: rewritten.skipped };
}

/** 改寫一段 CSS 內所有的 `url()` 與 `@import`；不載入的都算進 `skipped`。 */
async function rewriteCss(
  css: string,
  directory: string,
  seen: Set<string>,
  depth: number,
): Promise<{ css: string; skipped: number }> {
  const references = collectCssReferences(css);
  const map = new Map<string, string>();
  let skippedCount = 0;

  await Promise.all(
    references.map(async (reference) => {
      const kind = referenceKind(reference);
      // data: 與 `url(#filter)` 這種片段參考原樣保留，改寫反而會弄壞它。
      if (kind === "inline" || kind === "anchor") {
        map.set(reference, reference);
        return;
      }
      if (kind !== "local") {
        skippedCount++;
        return;
      }

      const target = localTarget(reference, directory);
      if (!target) {
        skippedCount++;
        return;
      }

      if (isStyleSheetPath(target)) {
        const loaded = await loadStyleSheet(reference, directory, seen, depth);
        if (loaded) {
          map.set(reference, loaded.url);
          skippedCount += loaded.skipped;
          return;
        }
      } else {
        const loaded = await loadResource(reference, directory);
        if (loaded) {
          map.set(reference, loaded.value);
          return;
        }
      }
      skippedCount++;
    }),
  );

  return {
    css: rewriteCssReferences(css, (reference) => map.get(reference) ?? null),
    skipped: skippedCount,
  };
}

/** 把文件裡的 `<link rel=stylesheet>`、`<style>` 與 `style=""` 全部前置處理完。 */
async function rewriteStyleSheets(
  source: string,
  directory: string,
): Promise<{ html: string; skipped: number }> {
  const doc = new DOMParser().parseFromString(source, "text/html");
  let skippedCount = 0;

  const links = [...doc.querySelectorAll('link[rel="stylesheet"][href]')];
  const linkResults = await Promise.all(
    links.map(async (link) => ({
      link,
      // 每一條鏈各自一組 seen：用來擋 @import 成環，不是全域去重。
      loaded: await loadStyleSheet(link.getAttribute("href") ?? "", directory, new Set(), 0),
    })),
  );
  for (const { link, loaded } of linkResults) {
    if (loaded) {
      link.setAttribute("href", loaded.url);
      skippedCount += loaded.skipped;
    } else {
      link.remove();
      skippedCount++;
    }
  }

  const styleNodes = [...doc.querySelectorAll("style"), ...doc.querySelectorAll("[style]")];
  const styleResults = await Promise.all(
    styleNodes.map(async (node) => {
      const isElement = node.tagName.toLowerCase() === "style";
      const css = isElement ? (node.textContent ?? "") : (node.getAttribute("style") ?? "");
      if (!css.trim()) {
        return { node, isElement, css: null, skipped: 0 };
      }
      const rewritten = await rewriteCss(css, directory, new Set(), 0);
      return { node, isElement, css: rewritten.css, skipped: rewritten.skipped };
    }),
  );
  for (const result of styleResults) {
    skippedCount += result.skipped;
    if (result.css === null) {
      continue;
    }
    if (result.isElement) {
      result.node.textContent = result.css;
    } else {
      result.node.setAttribute("style", result.css);
    }
  }

  return { html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, skipped: skippedCount };
}

async function prepare() {
  generation++;
  const current = generation;
  releaseBlobs();
  preparedHtml.value = null;

  const snapshot = sanitized.value;
  skipped.value = snapshot.skipped;

  const styled = await rewriteStyleSheets(snapshot.html, baseDir.value);
  if (current !== generation) {
    return;
  }
  skipped.value += styled.skipped;
  preparedHtml.value = styled.html;
}

/** 進畫面後才處理圖片：文字先出來，大圖再一塊一塊補上。 */
async function applyResources(doc: Document, current: number) {
  const directory = baseDir.value;

  const sources = [...doc.querySelectorAll(`[${DEFERRED_SRC_ATTRIBUTE}]`)];
  const srcsets = [...doc.querySelectorAll(`[${DEFERRED_SRCSET_ATTRIBUTE}]`)];
  const images = [...doc.querySelectorAll(`image[${DEFERRED_HREF_ATTRIBUTE}]`)];

  await Promise.all([
    ...sources.map((element) => rewriteSource(element, directory, current)),
    ...srcsets.map((element) => rewriteSrcset(element, directory, current)),
    ...images.map((element) => rewriteImageHref(element, directory, current)),
  ]);
}

/** `data-pufffile-src` 一定是清洗階段判定過的本機路徑；讀不到就整條拿掉。 */
async function rewriteSource(element: Element, directory: string, current: number) {
  const reference = element.getAttribute(DEFERRED_SRC_ATTRIBUTE) ?? "";
  if (!reference) {
    return;
  }
  const loaded = await loadResource(reference, directory);
  if (current !== generation) {
    if (loaded) {
      revokeBlob(loaded.blob);
    }
    return;
  }
  element.removeAttribute(DEFERRED_SRC_ATTRIBUTE);
  if (loaded) {
    element.setAttribute("src", loaded.value);
  } else {
    skipped.value++;
    replaceMissingImage(element);
  }
}

async function rewriteSrcset(element: Element, directory: string, current: number) {
  const value = element.getAttribute(DEFERRED_SRCSET_ATTRIBUTE) ?? "";
  element.removeAttribute(DEFERRED_SRCSET_ATTRIBUTE);
  const candidates = splitSrcset(value);
  if (candidates.length === 0) {
    return;
  }

  const rewritten = await Promise.all(
    candidates.map(async (candidate): Promise<SrcsetCandidate | null> => {
      const kind = referenceKind(candidate.reference);
      // `srcset` 可能是「data: 與本機檔混合」，data: 那幾個原樣留著。
      if (kind === "inline" || kind === "anchor") {
        return candidate;
      }
      if (kind !== "local") {
        return null;
      }
      const loaded = await loadResource(candidate.reference, directory);
      if (current !== generation) {
        if (loaded) {
          revokeBlob(loaded.blob);
        }
        return null;
      }
      return loaded ? { reference: loaded.value, descriptor: candidate.descriptor } : null;
    }),
  );
  if (current !== generation) {
    return;
  }

  const kept = rewritten.filter((candidate): candidate is SrcsetCandidate => candidate !== null);
  skipped.value += rewritten.length - kept.length;
  if (kept.length > 0) {
    element.setAttribute("srcset", joinSrcset(kept));
  } else {
    element.removeAttribute("srcset");
    // 只剩 srcset 的圖片（例如 `<picture>` 裡的那個）整組都讀不到時，也不要留破圖。
    if (element.tagName.toLowerCase() === "img" && !element.hasAttribute("src")) {
      replaceMissingImage(element);
    }
  }
}

async function rewriteImageHref(element: Element, directory: string, current: number) {
  const reference = element.getAttribute(DEFERRED_HREF_ATTRIBUTE) ?? "";
  if (!reference) {
    return;
  }
  const loaded = await loadResource(reference, directory);
  if (current !== generation) {
    if (loaded) {
      revokeBlob(loaded.blob);
    }
    return;
  }
  element.removeAttribute(DEFERRED_HREF_ATTRIBUTE);
  if (loaded) {
    element.setAttribute("href", loaded.value);
  } else {
    skipped.value++;
  }
}

function blockContextMenu(event: Event) {
  event.preventDefault();
}

/** 框內的鍵盤事件不會冒泡到母視窗；這裡重送一次，讓既有快速鍵邏輯原封不動生效。 */
function forwardKeydown(event: KeyboardEvent) {
  const forwarded = new KeyboardEvent("keydown", {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    bubbles: true,
    cancelable: true,
  });
  if (!window.dispatchEvent(forwarded)) {
    event.preventDefault();
  }
}

function onFrameClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest("a");
  if (!anchor) {
    return;
  }

  const reference = anchor.getAttribute("href") ?? "";
  const kind = referenceKind(reference);
  if (kind === "anchor") {
    return;
  }
  event.preventDefault();

  if (kind === "remote") {
    void explorer.openPath(reference);
    return;
  }
  if (kind === "local") {
    const path = localTarget(reference, baseDir.value);
    if (path) {
      void openLocalTarget(props.paneId, path);
    }
  }
}

function onFrameLoad() {
  const doc = frame.value?.contentDocument;
  if (!doc) {
    return;
  }
  doc.addEventListener("keydown", forwardKeydown);
  doc.addEventListener("click", onFrameClick);
  doc.addEventListener("contextmenu", blockContextMenu);
  frameReady.value += 1;
  // 資源改寫完（圖片、外部 CSS）再通知一次：畫面高度穩定後命中位置才準。
  void applyResources(doc, generation).finally(() => {
    frameReady.value += 1;
  });
}

watch(
  [() => sanitized.value.html, baseDir],
  () => {
    void prepare();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  generation++;
  releaseBlobs();
});
</script>

<template>
  <div v-if="state" ref="host" class="relative flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
    <ViewerNotice v-if="notice" :text="notice" />

    <div
      v-if="preparedHtml === null"
      class="flex min-h-0 flex-1 items-center justify-center text-sm text-ink-faint"
    >
      正在準備預覽…
    </div>
    <iframe
      v-else
      ref="frame"
      class="min-h-0 w-full flex-1 border-0 bg-white"
      title="HTML 預覽"
      sandbox="allow-same-origin"
      referrerpolicy="no-referrer"
      :srcdoc="preparedHtml"
      @load="onFrameLoad"
    />

    <ViewerSearchPanel
      v-if="searchOpen"
      :pane-id="paneId"
      :host="host"
      :root="frameBody"
      :source="frameReady"
    />
  </div>
</template>
