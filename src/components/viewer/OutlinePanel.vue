<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import FloatingPanel from "./FloatingPanel.vue";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import type { OutlineItem } from "@/types/viewer";
import {
  estimatePanelContent,
  PANEL_DEFAULT_WIDTH,
  type PanelLayout,
} from "@/utils/viewerPanel";

/**
 * 檢視器右上角的目錄索引面板。
 *
 * 兩個檢視器共用同一個面板：Markdown 列 h1～h6，DOCX 列使用者加的書籤。
 * 面板只負責畫清單 —— 位置、大小、收合、拖曳手勢在 `FloatingPanel`／`useViewerPanel`；
 * 標題錨點與捲動同步在 `useMarkdownScrollSpy`／`useScrollSpy`（由各自的檢視器持有）；
 * 這裡只量清單高度、畫出 `activeId`、把點擊與列上的動作往上送。
 *
 * `peek` 是 Markdown 專用的顯示模式：面板平常收成一顆圓形泡泡，滑過或聚焦才展開，
 * 點目錄項目立刻收回去，標題列的釘選鈕可以固定展開（DOCX 的書籤目錄沒有這一套）。
 *
 * 面板的收合與位置尺寸住在 viewer 狀態（每個檢視器一份、不持久化），
 * 換一份文件就回到預設值。
 */
const props = defineProps<{
  paneId: PaneId;
  /** 面板標題（Markdown＝「目錄索引」、DOCX＝「書籤目錄」）。 */
  title: string;
  items: OutlineItem[];
  activeId: string | null;
  /** 定位容器（檢視器的根節點）；量測可用範圍用。 */
  host: HTMLElement | null;
  /** 沒有項目時顯示的說明（沒給就整塊留白）。 */
  emptyText?: string;
  /** 顯示列上的「重新命名／刪除」（書籤目錄才有；Markdown 的標題列是唯讀的）。 */
  editable?: boolean;
  /** 面板配色跟隨底下的內容：`true` 用淺色（DOCX 的白紙），其餘跟隨主題。 */
  light?: boolean;
  /** 圓形泡泡模式（見上方說明）。 */
  peek?: boolean;
  /** 釘選：維持展開（只有 `peek` 模式有這顆按鈕）。 */
  pinned?: boolean;
}>();

const emit = defineEmits<{
  jump: [id: string];
  rename: [id: string];
  remove: [id: string];
  togglePin: [];
}>();

const viewer = useViewerStore();
const state = computed(() => viewer.of(props.paneId));

const FALLBACK: PanelLayout = { x: null, y: 0, width: PANEL_DEFAULT_WIDTH, height: null };
/** 泡泡模式的收合外觀由 `FloatingPanel` 決定，這裡不套用面板自己的 `collapsed`。 */
const collapsed = computed(() => (props.peek ? false : (state.value?.tocPanel.collapsed ?? false)));
const initialLayout = computed(() => state.value?.tocPanel.layout ?? FALLBACK);

const panel = useTemplateRef<{ collapsePeek: () => void }>("panel");
const listEl = useTemplateRef<HTMLElement>("list");
const listHeight = ref(0);

/**
 * 清單卸載時（收成泡泡）用列數估算內容高度：面板要拿「展開後會佔多少」去避讓
 * 另一個浮動面板，估成 0 會讓搜尋面板貼在泡泡下緣、目錄一展開就被蓋住。
 */
const contentHeight = computed(() => listHeight.value || estimatePanelContent(props.items.length));

const dragLabel = computed(() =>
  props.peek
    ? `${props.title}，移上來或聚焦即展開；可拖曳移動，方向鍵移動，Enter 收合或展開`
    : `${props.title}，可拖曳移動；方向鍵移動，Enter 收合或展開`,
);

function measureList() {
  listHeight.value = listEl.value?.scrollHeight ?? 0;
}

/*
 * 面板要等量到容器尺寸才會真的畫出來（`rect` 從 null 變成物件），所以清單
 * 元素是後掛上來的；除了清單換一批，清單本身出現時也要重新量一次自然高度。
 */
watch(
  [listEl, () => props.items, collapsed],
  () => {
    void nextTick(measureList);
  },
  { flush: "post" },
);

/** 列上的提示：失效的書籤要說清楚為什麼淡化，截斷的名稱要能看全文。 */
function itemTitle(item: OutlineItem): string {
  if (item.stale) {
    return `${item.text || "（無標題）"}（找不到位置，文件可能已修改）`;
  }
  return item.text || "（無標題）";
}

/** 目前項目若捲出目錄可視範圍，把它帶回清單內（只動這個清單的 scrollTop）。 */
function scrollActiveIntoView() {
  const id = props.activeId;
  const list = listEl.value;
  if (!id || !list) {
    return;
  }
  const item = Array.from(list.querySelectorAll<HTMLElement>("[data-toc-id]")).find(
    (element) => element.dataset.tocId === id,
  );
  if (!item) {
    return;
  }
  // 用矩形差值而不是 offsetTop：面板本身是定位元素，offsetParent 不是清單。
  const listRect = list.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  if (itemRect.top < listRect.top) {
    list.scrollTop += itemRect.top - listRect.top;
  } else if (itemRect.bottom > listRect.bottom) {
    list.scrollTop += itemRect.bottom - listRect.bottom;
  }
}

watch(() => props.activeId, scrollActiveIntoView);

/*
 * 圓形泡泡會把清單整塊卸載，重新展開時清單是新的元素（scrollTop 回到 0）：
 * 掛上來的這一刻要把目前章節帶回可視範圍，否則每次展開都停在文件最前面。
 */
watch(
  listEl,
  () => {
    if (listEl.value) {
      scrollActiveIntoView();
    }
  },
  { flush: "post" },
);

/** 點項目：跳過去，並把泡泡收起來（釘選時由 `FloatingPanel` 自行忽略）。 */
function onJump(id: string) {
  emit("jump", id);
  panel.value?.collapsePeek();
}
</script>

<template>
  <FloatingPanel
    ref="panel"
    :pane-id="paneId"
    panel="toc"
    :title="title"
    icon="toc"
    :drag-label="dragLabel"
    :resize-label="`調整${title}大小；方向鍵調整寬高`"
    :host="host"
    :light="light"
    :collapsed="collapsed"
    :peek="peek"
    :pinned="pinned"
    :initial-layout="initialLayout"
    :content-height="contentHeight"
    @persist="viewer.setPanelLayout(paneId, 'toc', $event)"
    @toggle-collapse="viewer.togglePanelCollapsed(paneId, 'toc')"
    @toggle-pin="emit('togglePin')"
  >
    <template #actions>
      <slot name="actions" />
    </template>

    <nav ref="list" class="scroll-area min-h-0 flex-1 overflow-y-auto p-1" :aria-label="title">
      <div
        v-for="item in items"
        :key="item.id"
        class="group flex items-center rounded-md"
        :class="item.id === activeId ? 'bg-accent-soft' : 'hover:bg-surface-hover'"
      >
        <button
          type="button"
          :data-toc-id="item.id"
          class="min-w-0 flex-1 rounded-md py-1 pr-1 text-left text-sm pressable"
          :class="
            item.id === activeId
              ? 'text-accent'
              : item.stale
                ? 'text-ink-faint'
                : 'text-ink-muted group-hover:text-ink'
          "
          :style="{ paddingLeft: `${8 + (item.level - 1) * 12}px` }"
          :title="itemTitle(item)"
          :aria-current="item.id === activeId ? 'location' : undefined"
          @click="onJump(item.id)"
        >
          <span class="flex items-center gap-1">
            <AppIcon v-if="item.stale" name="alert" :size="12" class="shrink-0" />
            <span class="truncate">{{ item.text || "（無標題）" }}</span>
          </span>
        </button>

        <!--
          列的動作平常收起來（滑過或鍵盤焦點進入才出現）：面板很窄，
          每一列都掛兩顆按鈕會把名稱擠掉。按鈕仍在 DOM 裡，Tab 走得到。
        -->
        <span
          v-if="editable"
          class="flex shrink-0 items-center gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <button
            type="button"
            class="flex size-5 items-center justify-center rounded text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
            title="重新命名書籤"
            aria-label="重新命名書籤"
            @click="emit('rename', item.id)"
          >
            <AppIcon name="pencil" :size="12" />
          </button>
          <button
            type="button"
            class="flex size-5 items-center justify-center rounded text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-danger"
            title="刪除這個書籤"
            aria-label="刪除這個書籤"
            @click="emit('remove', item.id)"
          >
            <AppIcon name="trash" :size="12" />
          </button>
        </span>
      </div>

      <p
        v-if="!items.length && emptyText"
        class="px-2 py-3 text-center text-xs leading-relaxed text-ink-faint"
      >
        {{ emptyText }}
      </p>
    </nav>
  </FloatingPanel>
</template>
