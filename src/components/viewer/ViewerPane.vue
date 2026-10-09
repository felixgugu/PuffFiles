<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import ErrorBanner from "@/components/common/ErrorBanner.vue";
import type { IconName } from "@/components/common/icons";
import DocxView from "./DocxView.vue";
import HtmlView from "./HtmlView.vue";
import ImageView from "./ImageView.vue";
import MarkdownView from "./MarkdownView.vue";
import PdfView from "./PdfView.vue";
import TextView from "./TextView.vue";
import { useMarkdownOutline } from "@/composables/useMarkdownOutline";
import { scrollViewer, useViewerScrollEdges } from "@/composables/useViewerNavigation";
import { useExplorerStore } from "@/stores/explorer";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import { formatBytes } from "@/utils/format";
import { colorFor, iconFor } from "@/utils/fileKind";
import {
  supportsViewerBookmarks,
  supportsViewerScroll,
  supportsViewerSearch,
} from "@/utils/viewer";
import { viewerHeaderFit } from "@/utils/viewerHeader";
import { panelFits } from "@/utils/viewerPanel";

/**
 * 檢視器窗格：標頭（檔名＋動作）＋內容。
 *
 * 只負責呈現與分派；讀檔、快取與自動重載都在 `stores/viewer.ts`。
 */
const props = defineProps<{ paneId: PaneId }>();

const explorer = useExplorerStore();
const settings = useSettingsStore();
const tabs = useTabsStore();
const viewer = useViewerStore();

const state = computed(() => viewer.of(props.paneId));

/*
 * 目錄索引開關：Markdown（自動抽取）與 DOCX／純文字（使用者自己加的書籤）共用同一顆
 * （面板本身也共用，見 `OutlinePanel`）。
 *
 * 窗格窄到放不下最小寬度的面板、Markdown 沒有標題、或純文字檔超過書籤的大小上限時，
 * 開關維持可見但反灰停用、並呈現關閉狀態 —— 使用者才看得出「這個功能現在不能用」，
 * 而不是按了沒反應。
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

/** 目前這個檢視器有沒有目錄索引面板；`null`＝這一種內容沒有。 */
const outlineKind = computed(() => {
  const kind = state.value?.kind;
  return kind === "markdown" || kind === "docx" || kind === "text" ? kind : null;
});
const outlineName = computed(() =>
  outlineKind.value === "markdown" ? "目錄索引" : "書籤目錄",
);
const outlineEnabled = computed(() =>
  outlineKind.value === "markdown"
    ? settings.markdownTocEnabled
    : settings.viewerBookmarksEnabled,
);
/** 書籤的內容大小限制（純文字 4 MB）；Markdown 沒有這條。 */
const outlineSizeOk = computed(() => {
  const current = state.value;
  if (!current || outlineKind.value === "markdown") {
    return true;
  }
  return supportsViewerBookmarks(current.kind, current.size);
});
const outlineAvailable = computed(
  () =>
    outlineKind.value !== null &&
    outlineSizeOk.value &&
    // Markdown 沒有標題就沒東西可列；書籤目錄隨時都能加第一筆。
    (outlineKind.value !== "markdown" || outline.value.headings.length > 0) &&
    panelFits(paneWidth.value, settings.viewerPanelMinWidth),
);
const tocOn = computed(() => outlineAvailable.value && outlineEnabled.value);
const tocTitle = computed(() => {
  if (outlineKind.value === "markdown" && !outline.value.headings.length) {
    return "這份文件沒有標題";
  }
  if (!panelFits(paneWidth.value, settings.viewerPanelMinWidth)) {
    return `窗格太窄，${outlineName.value}已隱藏`;
  }
  if (!outlineSizeOk.value) {
    return "檔案過大，書籤目錄已停用";
  }
  return outlineEnabled.value
    ? `${outlineName.value}（開啟）`
    : `${outlineName.value}（關閉）`;
});

function toggleOutline() {
  if (outlineKind.value !== "markdown") {
    settings.setViewerBookmarks(!settings.viewerBookmarksEnabled);
    return;
  }
  settings.toggleMarkdownToc();
}

/*
 * 標頭右側的四顆膠囊。
 *
 * 依性質分組（捲動／檢視器／檔案動作／窗格），每顆膠囊是一組 `v-for` 的動作；
 * 檢視器那一顆的內容隨種類增減，空的整顆不畫。按鈕 24px、圖示 14px，與路徑列的
 * 兩顆膠囊同一組尺寸。
 */
interface HeaderAction {
  id: string;
  icon: IconName;
  title: string;
  /** 切換類（搜尋、目錄、模式）：按下時用強調色標示。 */
  active?: boolean;
  disabled?: boolean;
  run: () => void;
}

const scrollEdges = useViewerScrollEdges(props.paneId);
const scrollable = computed(() => supportsViewerScroll(state.value?.kind ?? null));

const scrollActions = computed<HeaderAction[]>(() => [
  {
    id: "top",
    icon: "chevronsUp",
    title: "跳到最上面 (Home)",
    disabled: scrollEdges.value.atTop,
    run: () => scrollViewer(props.paneId, "top"),
  },
  {
    id: "page-up",
    icon: "pageUp",
    title: "往上捲一頁 (PageUp)",
    disabled: scrollEdges.value.atTop,
    run: () => scrollViewer(props.paneId, "page-up"),
  },
  {
    id: "page-down",
    icon: "pageDown",
    title: "往下捲一頁 (PageDown)",
    disabled: scrollEdges.value.atBottom,
    run: () => scrollViewer(props.paneId, "page-down"),
  },
  {
    id: "bottom",
    icon: "chevronsDown",
    title: "跳到最下面 (End)",
    disabled: scrollEdges.value.atBottom,
    run: () => scrollViewer(props.paneId, "bottom"),
  },
]);

const viewerActions = computed<HeaderAction[]>(() => {
  const current = state.value;
  if (!current) {
    return [];
  }
  const actions: HeaderAction[] = [];
  if (supportsViewerSearch(current.kind)) {
    actions.push({
      id: "search",
      icon: "search",
      title: searchTitle.value,
      active: searchOn.value,
      disabled: !searchFits.value,
      run: () => viewer.toggleSearch(props.paneId),
    });
  }
  if (outlineKind.value) {
    actions.push({
      id: "outline",
      icon: "toc",
      title: tocTitle.value,
      active: tocOn.value,
      disabled: !outlineAvailable.value,
      run: toggleOutline,
    });
  }
  if (isHtml.value) {
    actions.push({
      id: "mode",
      icon: previewing.value ? "code" : "eye",
      title: previewing.value ? "看原始碼" : "看預覽",
      run: toggleMode,
    });
  }
  return actions;
});

const fileActions = computed<HeaderAction[]>(() => {
  const actions: HeaderAction[] = [
    { id: "open-default", icon: "externalLink", title: "用預設程式開啟", run: openWithDefault },
    { id: "reveal", icon: "folderOpen", title: "在檔案總管中顯示", run: reveal },
  ];
  if (state.value?.kind !== null) {
    actions.push({
      id: "reload",
      icon: "refresh",
      title: "重新整理 (F5)",
      run: () => void viewer.reload(props.paneId),
    });
  }
  return actions;
});

const paneActions = computed<HeaderAction[]>(() => [
  {
    id: "maximize",
    icon: maximized.value ? "paneRestore" : "paneMaximize",
    title: maximized.value ? "還原分割" : "放到最大",
    active: maximized.value,
    disabled: !canMaximize.value,
    run: () => tabs.toggleMaximize(props.paneId),
  },
  {
    id: "close",
    icon: "close",
    title: "關閉檢視器 (Esc)",
    run: () => viewer.close(props.paneId),
  },
]);

/** 塞不下時先收起捲動、再收起檔案動作（見 `utils/viewerHeader.ts`）。 */
const headerFit = computed(() =>
  viewerHeaderFit({
    paneWidth: paneWidth.value,
    scroll: scrollable.value,
    viewer: viewerActions.value.length,
    file: fileActions.value.length,
  }),
);

const capsules = computed(() =>
  [
    { id: "scroll", label: "捲動", actions: scrollActions.value, show: headerFit.value.scroll },
    { id: "viewer", label: "檢視器", actions: viewerActions.value, show: viewerActions.value.length > 0 },
    { id: "file", label: "檔案動作", actions: fileActions.value, show: headerFit.value.file },
    { id: "pane", label: "窗格", actions: paneActions.value, show: true },
  ].filter((capsule) => capsule.show),
);

/*
 * 搜尋鈕：所有文字類檢視器（Markdown／HTML／純文字與程式碼）都有。
 * 面板開關是每個窗格各自的狀態，住在 viewer store 的 ViewerState.search。
 */
const searchOpen = computed(() => state.value?.search.open === true);
const searchFits = computed(() => panelFits(paneWidth.value, settings.viewerPanelMinWidth));
const searchOn = computed(() => searchOpen.value && searchFits.value);
const searchTitle = computed(() => {
  if (!searchFits.value) {
    return "窗格太窄，搜尋面板已隱藏";
  }
  return searchOpen.value ? "關閉搜尋 (Ctrl+F)" : "在檢視器內搜尋 (Ctrl+F)";
});

/*
 * 放到最大：把同一個分頁的另一個窗格收合成 0，分頁標題改用檔名（見 `stores/tabs.ts`）。
 * 只有分割時才有「另一窗格」可隱藏；單一窗格時按鈕維持可見但淡化停用。
 */
const canMaximize = computed(() => (tabs.activeTab?.paneIds.length ?? 0) > 1);
const maximized = computed(() => tabs.activeTab?.maximizedPaneId === props.paneId);

const extension = computed(() => extensionOf(state.value?.path ?? ""));

/**
 * 「看起來像 Word，但不是 DOCX」的格式最容易讓人以為是壞了。
 *
 * `.docx`／`.docm` 有內建檢視器；`.doc` 是 OLE 二進位、`.rtf`／`.odt` 也不是 ZIP，
 * 解析不了就只能交給系統預設程式 —— 這裡把話說清楚，不要只留一句「還沒有檢視器」。
 */
const LEGACY_DOCUMENT_EXTENSIONS = new Set(["doc", "rtf", "odt"]);
const noViewerHint = computed(() =>
  LEGACY_DOCUMENT_EXTENSIONS.has((extension.value ?? "").toLowerCase())
    ? "這是舊版或其他文書格式（只有 Word 的 .docx／.docm 有內建檢視器），請用預設程式開啟"
    : "",
);

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

      <!--
        動作分成四顆膠囊：捲動｜檢視器｜檔案動作｜窗格。窗格太窄時依序收起
        （`utils/viewerHeader.ts`），搜尋／目錄／關閉永遠保留。
      -->
      <div class="ml-auto flex shrink-0 items-center gap-1">
        <div
          v-for="capsule in capsules"
          :key="capsule.id"
          role="group"
          :aria-label="capsule.label"
          class="flex items-center gap-0.5 rounded-lg bg-surface-muted p-0.5"
        >
          <button
            v-for="action in capsule.actions"
            :key="action.id"
            type="button"
            class="flex size-6 items-center justify-center rounded-md pressable disabled:opacity-30"
            :class="
              action.active
                ? 'bg-accent-soft text-accent'
                : 'text-ink-muted enabled:hover:bg-surface-hover enabled:active:bg-pressed enabled:hover:text-ink'
            "
            :aria-pressed="action.active"
            :disabled="action.disabled"
            :title="action.title"
            @click="action.run()"
          >
            <AppIcon :name="action.icon" :size="14" />
          </button>
        </div>
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
      <p v-if="noViewerHint" class="text-xs text-ink-faint">{{ noViewerHint }}</p>
    </div>

    <MarkdownView v-else-if="state.kind === 'markdown'" :pane-id="paneId" />
    <HtmlView v-else-if="state.kind === 'html' && state.mode === 'preview'" :pane-id="paneId" />
    <ImageView v-else-if="state.kind === 'image'" :pane-id="paneId" />
    <PdfView v-else-if="state.kind === 'pdf'" :pane-id="paneId" />
    <DocxView v-else-if="state.kind === 'docx'" :pane-id="paneId" />
    <TextView v-else :pane-id="paneId" />
  </div>
</template>
