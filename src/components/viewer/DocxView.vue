<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import BookmarkOutline from "./BookmarkOutline.vue";
import ViewerSearchPanel from "./ViewerSearchPanel.vue";
import { useViewerBookmarks } from "@/composables/useViewerBookmarks";
import { useLocalNavigation } from "@/composables/useLocalNavigation";
import { useViewerScroll } from "@/composables/useViewerScroll";
import { useExplorerStore } from "@/stores/explorer";
import { useSettingsStore } from "@/stores/settings";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import { collectBlobUrls, docxZoom } from "@/utils/docx";
import { parentOf, resolveLocalPath } from "@/utils/path";
import type { Options } from "docx-preview";

/**
 * DOCX 內容：用 docx-preview 把文件排成一頁頁的 DOM。
 *
 * 位元組由 store 從自訂協定（`stream`）抓回來（`ViewerState.bytes`），這裡只負責排版、
 * 縮放、連結與 blob 的生命週期。**頁面固定白底黑字**（與 PDF viewer 一致）：
 * 文件的顏色是內容的一部分，跟著主題反轉會讓圖片與配色失真。
 *
 * 排版是就地改 DOM（`renderAsync` 會清空容器再寫入），所以容器裡不能有 Vue 管的節點。
 */
const props = defineProps<{ paneId: PaneId }>();

const viewer = useViewerStore();
const explorer = useExplorerStore();
const settings = useSettingsStore();
const { openLocalTarget } = useLocalNavigation();

const state = computed(() => viewer.of(props.paneId));
const host = useTemplateRef<HTMLElement>("host");
const scroller = useTemplateRef<HTMLElement>("scroller");
const content = useTemplateRef<HTMLElement>("content");

/** 捲動位置：切換分頁再回來時要回到原本讀到的地方（見 `useViewerScroll`）。 */
const scroll = useViewerScroll(props.paneId, scroller);

const rendering = ref(false);
/** 排完一次版就 +1：搜尋面板靠它知道「現在這份 DOM 才是新的」。 */
const rendered = ref(0);

/**
 * 書籤目錄：把選取的文字變成可以跳回來的位置。
 *
 * 位置每次排版後重新對回 DOM（`revision` 就是下面的 `rendered`），
 * 所以切換分頁重掛、F5 重新載入或外部修改後自動重載都不會走位。
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
  viewport: () => scroller.value,
  content: () => content.value,
  // DOCX 的位置記在區塊裡，不需要整份文字。
  text: () => "",
  size: () => state.value?.size ?? 0,
  revision: () => rendered.value,
  path: () => state.value?.path ?? "",
});

/**
 * docx-preview 的 lazy chunk：第一次真的開 DOCX 才下載（與 Mermaid 同一手法，
 * 不開文件的人不會付這筆下載與解析成本）。
 */
let modulePromise: Promise<typeof import("docx-preview")> | null = null;
function docxModule() {
  modulePromise ??= import("docx-preview");
  return modulePromise;
}

/**
 * 排版選項。只寫出與預設不同的兩個，其餘（保留頁面寬度與最小高度、頁首頁尾、註腳、
 * 圖片用 blob URL）都照 docx-preview 的預設值。
 */
const RENDER_OPTIONS: Partial<Options> = {
  // Word 會把「自動換頁」的位置寫成 lastRenderedPageBreak，預設值卻忽略它們 ——
  // 一份沒有手動分頁的文件會變成一頁到底。打開才看得到接近 Word 的分頁。
  ignoreLastRenderedPageBreak: false,
  // altChunk 是嵌入的原始 HTML 片段，docx-preview 用 innerHTML 插進同一個 document，
  // `<img onerror=…>` 這類事件屬性會真的執行。本專案一律不執行文件裡的程式碼
  // （Markdown 也把原始 HTML escape 掉、HTML 預覽不給 allow-scripts）。
  renderAltChunks: false,
};

/** 頁面的自然寬度（px）：每次排版量一次，之後只重套縮放。 */
let pageWidth = 0;
/** 這一輪排版的序號；換檔、重新載入與卸載都會讓舊的一輪直接放棄。 */
let generation = 0;

/** 把頁面縮到剛好塞進窗格（頁面比窗格窄就維持 100%）。 */
function applyFit() {
  const box = scroller.value;
  const wrapper = content.value?.querySelector<HTMLElement>(".docx-wrapper");
  if (!box || !wrapper || pageWidth <= 0) {
    return;
  }
  // 扣掉外框左右各 16px 的內距，那是不屬於頁面的留白。
  wrapper.style.zoom = String(docxZoom(box.clientWidth - 32, pageWidth));
}

function revoke(urls: string[]) {
  for (const url of urls) {
    URL.revokeObjectURL(url);
  }
}

async function render() {
  const current = state.value;
  const target = content.value;
  if (!current?.bytes || !target) {
    return;
  }

  const token = ++generation;
  rendering.value = true;
  // 上一份文件留下的 blob URL（圖片、嵌入字型）：docx-preview 從不撤銷，
  // 這裡接手，連續預覽十幾份含圖文件才不會一份一份堆積記憶體。
  const stale = collectBlobUrls(target);

  try {
    const { renderAsync } = await docxModule();
    if (token !== generation) {
      return;
    }
    await renderAsync(current.bytes, target, target, RENDER_OPTIONS);
  } catch {
    if (token === generation) {
      viewer.fail(
        props.paneId,
        "這份文件無法解析（可能已加密或損壞），請用預設程式開啟",
      );
    }
    return;
  } finally {
    if (token === generation) {
      rendering.value = false;
    }
    // 舊的那一批一定沒人用了；容器要是已經被拆掉（關閉檢視器時還在排版），
    // 剛排好的那一批也一起還 —— 直接寫進 detached 容器的 blob 沒有人會再看到。
    revoke(stale);
    if (!target.isConnected) {
      revoke(collectBlobUrls(target));
    }
  }

  if (token !== generation) {
    return;
  }
  // 量自然寬度：先把縮放歸 1，量到的才是版面真正的寬度。
  const wrapper = target.querySelector<HTMLElement>(".docx-wrapper");
  if (wrapper) {
    wrapper.style.zoom = "1";
    pageWidth = target.querySelector<HTMLElement>("section.docx")?.offsetWidth ?? 0;
    applyFit();
  }

  rendered.value += 1;
  // 內容剛剛才進 DOM，掛載當下設的 `scrollTop` 會被空容器夾成 0，這裡再還原一次。
  await nextTick();
  scroll.restore();
}

/**
 * 連結：一律攔下來自己處理。
 *
 * 放著不管的話，`<a href="https://…">` 會把整個應用程式導覽走（WebView 原地跳頁），
 * 相對路徑則會變成找不到的網址。`http(s)`／`mailto` 交給系統預設程式，
 * 其餘當成本機路徑，比照 Markdown 檢視器在同一個窗格導覽過去。
 */
function onContentClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest("a[href]");
  if (!anchor) {
    return;
  }
  event.preventDefault();

  const href = anchor.getAttribute("href") ?? "";
  // `#書籤`：docx-preview 沒有替書籤產生 id，沒有地方可以跳，維持原狀。
  if (!href || href.startsWith("#")) {
    return;
  }
  if (/^(https?|mailto):/i.test(href)) {
    void explorer.openPath(href);
    return;
  }
  const resolved = resolveLocalPath(parentOf(state.value?.path ?? "") ?? "", href);
  if (resolved) {
    void openLocalTarget(props.paneId, resolved);
  }
}

let observer: ResizeObserver | null = null;

onMounted(() => {
  // 分頁切回來時元件是重新掛載的，`bytes` 早就在 store 裡，直接排一次。
  void render();
  const box = scroller.value;
  if (box) {
    observer = new ResizeObserver(() => applyFit());
    observer.observe(box);
  }
});

onBeforeUnmount(() => {
  // 讓還在路上的一輪作廢，不要寫進已經拆掉的容器。
  generation += 1;
  observer?.disconnect();
  const target = content.value;
  if (target) {
    revoke(collectBlobUrls(target));
  }
});

/** 換檔案或重新載入（新的位元組）就重排一次。 */
watch(
  () => state.value?.bytes,
  () => void render(),
);
</script>

<template>
  <div ref="host" class="relative flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
    <!--
      `select-text`：內文要能選取複製（`body` 預設是 `user-select: none`）。
      這裡刻意**不**掛 `data-native-menu`：檢視器內文不提供原生右鍵選單，
      複製走 Ctrl+C（見 `main.ts` 的攔截與 `AGENTS.md` §3.5）。
      `isolate`：內文自成一個堆疊脈絡，文件帶進來的 z-index（`docx-preview` 的
      `section.docx > article` 就有 `z-index: 1`）不可能蓋到浮動面板上。
      連結另外由 `onContentClick` 攔下來。
    -->
    <div
      ref="scroller"
      tabindex="-1"
      class="docx-host scroll-area isolate min-h-0 flex-1 overflow-auto select-text"
      @click="onContentClick"
      @scroll.passive="scroll.save"
    >
      <div ref="content" class="docx-view" />
    </div>

    <div
      v-if="rendering"
      class="pointer-events-none absolute inset-0 flex items-center justify-center bg-canvas text-sm text-ink-faint"
    >
      正在排版…
    </div>

    <BookmarkOutline
      v-if="settings.viewerBookmarksEnabled && bookmarksEnabled"
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
      v-if="state?.search.open"
      :key="state?.path"
      :pane-id="paneId"
      :host="host"
      :root="content"
      :source="rendered"
      light
    />
  </div>
</template>

<style scoped>
/*
 * docx-preview 產生的節點不是 Vue 模板的一員（不會有 scoped 的 data 屬性），
 * 所以內文要用 `:deep()` 才打得到。這裡只覆寫「內建樣式不適合本專案」的部分：
 * 內建的灰底與 30px 內距太像獨立頁面，縮到與窗格同一種材質才不刺眼。
 */
.docx-host :deep(.docx-wrapper) {
  padding: 16px 16px 0;
  background: transparent;
}

.docx-host :deep(.docx-wrapper > section.docx) {
  margin-bottom: 16px;
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.16),
    0 4px 12px rgb(0 0 0 / 0.12);
}

/* Tailwind 的 preflight 把所有 img 變成 block，會把行內圖片（符號、行內公式）推到下一行。 */
.docx-host :deep(.docx-wrapper img) {
  display: inline;
  max-width: 100%;
  vertical-align: middle;
}

/*
 * 跳到書籤時的標示：**固定在白紙上的淡藍底**，不跟著主題換色。
 *
 * 與頁面本身（永遠白底黑字，見上）同一套立場：這一塊是文件的座標，不是介面材質。
 * 只用 `background-color`（不動版面、不位移），樣式交給計時器移除 ——
 * 不是 `@keyframes`：全站的「減少動態」會把動畫時間壓成 1ms，那樣跳過去等於沒有標示。
 */
.docx-host :deep(.docx-bookmark-flash) {
  background-color: rgb(37 99 235 / 0.22);
  transition: background-color 140ms ease-out;
}
</style>
