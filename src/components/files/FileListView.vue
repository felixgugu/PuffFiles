<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ContextMenu from "@/components/overlays/ContextMenu.vue";
import FileTableRow from "./FileTableRow.vue";
import { ADD_TO_FOLDERS_ID, useAddToFolders } from "@/composables/useAddToFolders";
import { useDragGesture } from "@/composables/useDragGesture";
import { usePathMenu } from "@/composables/usePathMenu";
import { useSyncedNavigation } from "@/composables/useSyncedNavigation";
import { useClipboardStore } from "@/stores/clipboard";
import { useCompareStore } from "@/stores/compare";
import { useExplorerStore } from "@/stores/explorer";
import { TREE_ROOT_CONTAINER } from "@/stores/folders";
import { COLUMN_FIT_MAX, useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import type { MenuRequest } from "@/composables/usePathMenu";
import type { ColumnId, FileEntry, PaneId, SortKey } from "@/types/fs";
import { cellText } from "@/utils/fileCells";
import { formatCount } from "@/utils/format";
import { samePath } from "@/utils/path";
import { measureText, widestText } from "@/utils/textMetrics";

const props = defineProps<{ paneId: PaneId }>();

const explorer = useExplorerStore();
const settings = useSettingsStore();
const tabs = useTabsStore();
const clipboard = useClipboardStore();
const compare = useCompareStore();
const ui = useUiStore();
const { menuFor, requestFor, blankRequest, run: runMenu } = usePathMenu();
const addToFolders = useAddToFolders();
const syncedNav = useSyncedNavigation();

const ROW_BASE_HEIGHT = 24;
/** 列高跟著字級縮放，否則放大字級時文字會擠出虛擬清單的固定列高。 */
const rowHeight = computed(() => Math.round(ROW_BASE_HEIGHT * settings.fontScale));
/** 表頭是 sticky 而且是 in-flow，佔掉內容最前面的這一段。 */
const HEADER_HEIGHT = 28;
const OVERSCAN = 6;

const pane = computed(() => explorer.meta(props.paneId)!);
const rows = explorer.visibleRef(props.paneId);

const scrollEl = useTemplateRef<HTMLElement>("scroll");
const scrollTop = ref(0);
const viewportHeight = ref(0);

let observer: ResizeObserver | null = null;

onMounted(() => {
  const element = scrollEl.value;
  if (!element) {
    return;
  }
  viewportHeight.value = element.clientHeight;
  observer = new ResizeObserver(() => {
    viewportHeight.value = element.clientHeight;
  });
  observer.observe(element);
});

onBeforeUnmount(() => observer?.disconnect());

const COLUMN_LABELS: Record<ColumnId, string> = {
  name: "名稱",
  kind: "類型",
  size: "大小",
  modified: "修改日期",
  created: "建立日期",
  attributes: "屬性",
  path: "路徑",
};

const SORTABLE: ColumnId[] = ["name", "kind", "size", "modified", "created"];

/** 每個欄位都是固定寬度，最後補一條彈性軌道吸收剩餘空間（沒有子元素也會佔位）。 */
const gridTemplate = computed(() =>
  `${settings.columns
    .map((column) => `${explorer.columnWidth(props.paneId, column)}px`)
    .join(" ")} minmax(0, 1fr)`,
);

/** 欄位可以拖到比視窗還寬；那時表頭與列一起水平捲動，所以兩者要同寬。 */
const columnsWidth = computed(() =>
  settings.columns.reduce((sum, column) => sum + explorer.columnWidth(props.paneId, column), 0),
);
const contentWidthStyle = computed(() => ({
  width: `max(100%, ${columnsWidth.value + 64}px)`,
}));

const resizing = ref<ColumnId | null>(null);
let widthAtDragStart = 0;

const columnDrag = useDragGesture({
  onStart: () => {
    widthAtDragStart = resizing.value ? explorer.columnWidth(props.paneId, resizing.value) : 0;
    document.body.style.cursor = "col-resize";
  },
  onMove: (state) => {
    if (resizing.value) {
      explorer.setColumnWidth(props.paneId, resizing.value, widthAtDragStart + state.dx);
    }
  },
  onEnd: () => {
    resizing.value = null;
    document.body.style.cursor = "";
  },
});

function startResize(column: ColumnId, event: PointerEvent) {
  resizing.value = column;
  columnDrag.onPointerDown(event);
}

/*
 * 雙擊欄寬把手＝自動調整到最寬內容（Alt+雙擊＝回復該欄預設寬度）。
 *
 * 開銷常數對應 FileTableRow 與表頭的 class，改版面時要一起改：
 * 每格 px-1＝8px；名稱欄前面還有圖示 15px 與 gap-2 8px；清單裡有符號連結時
 * 再加「連結」徽章與它的 gap-2（約 36px）；表頭按鈕也是 px-1，排序時多一個
 * chevron 11px＋gap-1 4px。
 */
const CELL_PADDING = 8;
const NAME_LEADING = 15 + 8;
const NAME_SYMLINK_BADGE = 36;
const HEADER_SORT_ICON = 11 + 4;
/** 次像素與 tabular-nums 的保險：寧可多一兩 px 也不要截字。 */
const FIT_SLACK = 2;

/** canvas 用的 CSS font 字串；取自實際元素，字型與字級設定改了也跟著準。 */
function fontOf(element: HTMLElement | null): string {
  if (!element) {
    return "";
  }
  const style = getComputedStyle(element);
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

/**
 * 量的是「目前清單」的全部項目（已套用搜尋與顯示隱藏項目），不是畫面上那幾十列，
 * 所以捲到哪裡雙擊、結果都一樣；文字走 canvas 量測，兩萬筆也只是一次短暫計算。
 */
function fitColumn(column: ColumnId, event: MouseEvent) {
  if (event.altKey) {
    explorer.resetColumnWidth(props.paneId, column);
    return;
  }
  const header = scrollEl.value?.querySelector<HTMLElement>("[data-header]") ?? null;
  const extra =
    CELL_PADDING +
    (column === "name"
      ? NAME_LEADING + (rows.value.some((entry) => entry.isSymlink) ? NAME_SYMLINK_BADGE : 0)
      : 0);
  const content = widestText(rows.value.map((entry) => cellText(column, entry)), fontOf(scrollEl.value));
  const headerNeed =
    measureText(COLUMN_LABELS[column], fontOf(header)) +
    CELL_PADDING +
    (pane.value.sortKey === column ? HEADER_SORT_ICON : 0);
  const next = Math.ceil(Math.max(content + extra, headerNeed) + FIT_SLACK);
  explorer.setColumnWidth(props.paneId, column, Math.min(next, COLUMN_FIT_MAX));
}

const start = computed(() =>
  Math.max(0, Math.floor((scrollTop.value - HEADER_HEIGHT) / rowHeight.value) - OVERSCAN),
);
const end = computed(() =>
  Math.min(
    rows.value.length,
    Math.ceil((scrollTop.value + viewportHeight.value - HEADER_HEIGHT) / rowHeight.value) + OVERSCAN,
  ),
);
const slice = computed(() => rows.value.slice(start.value, Math.max(end.value, 0)));
const offsetY = computed(() => start.value * rowHeight.value);
const totalHeight = computed(() => rows.value.length * rowHeight.value);

const isEmpty = computed(() => pane.value.status !== "loading" && rows.value.length === 0);

const emptyTitle = computed(() => {
  if (!pane.value.currentPath) {
    return "還沒有開啟資料夾";
  }
  return pane.value.query.trim() ? "沒有符合的項目" : "這個資料夾是空的";
});

const emptyDescription = computed(() => {
  if (!pane.value.currentPath) {
    return "從左側清單選擇一個資料夾，或按「加入」把常用的工作資料夾加進來。";
  }
  return pane.value.query.trim()
    ? `找不到包含「${pane.value.query.trim()}」的檔案或資料夾。`
    : "可以在這裡建立新的資料夾。";
});

function onScroll() {
  scrollTop.value = scrollEl.value?.scrollTop ?? 0;
}

/** 表頭也是這個捲動容器的一部分，點它不該被當成「點空白處」。 */
function isChrome(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("[data-row], [data-header]");
}

/* ---------------------------------------------------------------------------
 * 選取：對齊檔案總管 —— 按下即選取、拖曳延伸範圍、空白處框選、到邊緣自動捲動。
 * ------------------------------------------------------------------------- */

/** 遲滯：超過這個距離才算拖曳，否則只當成點擊。 */
const DRAG_THRESHOLD = 4;
/** 拖到距離上下邊緣這麼近就開始自動捲動。 */
const EDGE_ZONE = 24;
const EDGE_SPEED = 18;

interface RowDrag {
  mode: "rows" | "marquee";
  /** 列模式：起點列索引。 */
  anchor: number;
  additive: boolean;
  moved: boolean;
  /** 按在已選取項目上時，放開且沒拖曳才收斂成單選。 */
  collapseTo: string | null;
  startX: number;
  startY: number;
  /** 相對於「列容器」的起點（已扣掉表頭高度）。 */
  startContent: { x: number; y: number };
  lastClientX: number;
  lastClientY: number;
}

let drag: RowDrag | null = null;
let autoScrollFrame = 0;
const marquee = ref<{ left: number; top: number; width: number; height: number } | null>(null);

/** 把指標位置換算成「列容器」座標：垂直已扣掉表頭，水平已計入捲動。 */
function toContentPoint(clientX: number, clientY: number) {
  const element = scrollEl.value;
  if (!element) {
    return { x: 0, y: 0 };
  }
  const rect = element.getBoundingClientRect();
  return {
    x: clientX - rect.left + element.scrollLeft,
    y: clientY - rect.top + element.scrollTop - HEADER_HEIGHT,
  };
}

function indexAt(contentY: number, clamp = false): number {
  const raw = Math.floor(contentY / rowHeight.value);
  if (clamp) {
    return Math.min(Math.max(raw, 0), Math.max(rows.value.length - 1, 0));
  }
  return raw < 0 || raw >= rows.value.length ? -1 : raw;
}

function onPointerDown(event: PointerEvent) {
  const element = scrollEl.value;
  if (event.button !== 0 || !element) {
    return;
  }
  const target = event.target as HTMLElement | null;
  if (target?.closest("[data-header]")) {
    return;
  }
  // 拖到捲軸上不該開始框選。
  const rect = element.getBoundingClientRect();
  if (event.clientX > rect.right - 14 || event.clientY > rect.bottom - 14) {
    return;
  }

  tabs.setActivePane(props.paneId);

  const rowElement = target?.closest<HTMLElement>("[data-row]") ?? null;
  const index = rowElement ? Number(rowElement.dataset.index ?? "0") : -1;

  drag = {
    mode: rowElement ? "rows" : "marquee",
    anchor: index,
    additive: event.ctrlKey || event.metaKey,
    moved: false,
    collapseTo: null,
    startX: event.clientX,
    startY: event.clientY,
    startContent: toContentPoint(event.clientX, event.clientY),
    lastClientX: event.clientX,
    lastClientY: event.clientY,
  };

  if (rowElement) {
    const path = rows.value[index]?.path;
    if (!path) {
      drag = null;
      return;
    }
    if (event.shiftKey) {
      explorer.selectRange(props.paneId, pane.value.focusedIndex, index);
    } else if (drag.additive) {
      explorer.select(props.paneId, path, "toggle");
    } else if (!pane.value.selected.includes(path)) {
      // 按下即選取：不等放開。
      explorer.select(props.paneId, path, "replace");
    } else {
      // 已經選取：先不動，這樣才拖得動一整組選取。
      drag.collapseTo = path;
    }
  }

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
  window.addEventListener("pointercancel", onPointerUp, { once: true });
}

function onPointerMove(event: PointerEvent) {
  const state = drag;
  if (!state) {
    return;
  }

  const dx = event.clientX - state.startX;
  const dy = event.clientY - state.startY;
  if (!state.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
    return;
  }
  state.moved = true;
  state.lastClientX = event.clientX;
  state.lastClientY = event.clientY;

  if (state.mode === "rows") {
    extendRowSelection(event.clientY);
  } else {
    updateMarquee(event.clientX, event.clientY);
  }
  updateAutoScroll(event.clientY);
}

function extendRowSelection(clientY: number) {
  const state = drag;
  if (!state) {
    return;
  }
  const to = indexAt(toContentPoint(state.lastClientX, clientY).y, true);
  explorer.selectRange(props.paneId, state.anchor, to, state.additive);
}

function updateMarquee(clientX: number, clientY: number) {
  const state = drag;
  if (!state) {
    return;
  }
  const point = toContentPoint(clientX, clientY);
  const left = Math.min(state.startContent.x, point.x);
  const top = Math.min(state.startContent.y, point.y);
  marquee.value = {
    left,
    top,
    width: Math.abs(point.x - state.startContent.x),
    height: Math.abs(point.y - state.startContent.y),
  };

  const from = indexAt(top, true);
  const to = indexAt(top + marquee.value.height, true);
  explorer.selectRange(props.paneId, from, to);
}

/** 指標靠近上下邊緣時持續捲動，並在捲動中延伸選取。 */
function updateAutoScroll(clientY: number) {
  const element = scrollEl.value;
  if (!element || !drag) {
    stopAutoScroll();
    return;
  }
  const rect = element.getBoundingClientRect();
  const delta =
    clientY < rect.top + EDGE_ZONE ? -EDGE_SPEED : clientY > rect.bottom - EDGE_ZONE ? EDGE_SPEED : 0;

  if (delta === 0) {
    stopAutoScroll();
    return;
  }
  if (autoScrollFrame) {
    return;
  }

  const step = () => {
    const state = drag;
    const target = scrollEl.value;
    if (!state || !target) {
      stopAutoScroll();
      return;
    }
    target.scrollTop += delta;
    if (state.mode === "rows") {
      extendRowSelection(state.lastClientY);
    } else {
      updateMarquee(state.lastClientX, state.lastClientY);
    }
    autoScrollFrame = requestAnimationFrame(step);
  };
  autoScrollFrame = requestAnimationFrame(step);
}

function stopAutoScroll() {
  if (autoScrollFrame) {
    cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = 0;
  }
}

function onPointerUp() {
  const state = drag;
  drag = null;
  window.removeEventListener("pointermove", onPointerMove);
  stopAutoScroll();
  marquee.value = null;

  if (!state) {
    return;
  }
  if (state.mode === "rows") {
    // 按在已選取的項目上、而且沒有拖曳 → 收斂成只選它。
    if (!state.moved && state.collapseTo) {
      explorer.select(props.paneId, state.collapseTo, "replace");
    }
    return;
  }
  if (!state.moved) {
    explorer.clearSelection(props.paneId);
  }
}

/** 鍵盤移動焦點時，把目標列捲進可視範圍（虛擬清單不能靠 scrollIntoView）。 */
watch(
  () => pane.value.focusedIndex,
  async (index) => {
    if (index < 0) {
      return;
    }
    await nextTick();
    const element = scrollEl.value;
    if (!element) {
      return;
    }
    const top = index * rowHeight.value;
    const bottom = top + rowHeight.value;
    const visibleTop = element.scrollTop + HEADER_HEIGHT;
    const visibleBottom = element.scrollTop + element.clientHeight;

    if (top < visibleTop) {
      element.scrollTop = Math.max(0, top - HEADER_HEIGHT);
    } else if (bottom > visibleBottom) {
      element.scrollTop = bottom - element.clientHeight;
    }
  },
);

interface MenuState {
  x: number;
  y: number;
  request: MenuRequest;
  /** 按住 Shift 開的「擴充選單」：剪貼與重新命名只在這裡出現。 */
  extended: boolean;
  /** 「加入我的資料夾」會原地換成第二段選單，這一段用來挑容器。 */
  stage: "main" | "container";
}

const menu = ref<MenuState | null>(null);

/** 正在就地重新命名的列（一次只會有一列）。 */
const renaming = ref<{ path: string; originalName: string } | null>(null);

const menuItems = computed(() => {
  const state = menu.value;
  if (!state) {
    return [];
  }
  if (state.stage === "container") {
    return addToFolders.containerItems();
  }
  const items = menuFor(state.request, { clipboard: state.extended, rename: state.extended });
  const { targets, target } = state.request;
  // 只有單一資料夾（或空白處的目前資料夾）才有東西可加；多選時不知道要加哪一個。
  if (targets.length === 1 && targets[0].isDir) {
    return addToFolders.place(items, targets[0].path, "afterOpen");
  }
  if (!targets.length && target.isDir) {
    return addToFolders.place(items, target.path, "end");
  }
  return items;
});

function openRowMenu(entry: FileEntry, event: MouseEvent) {
  tabs.setActivePane(props.paneId);
  if (!pane.value.selected.includes(entry.path)) {
    explorer.select(props.paneId, entry.path);
  }
  menu.value = {
    x: event.clientX,
    y: event.clientY,
    request: requestFor(props.paneId, { path: entry.path, isDir: entry.isDir }),
    extended: event.shiftKey,
    stage: "main",
  };
}

/** 空白處右鍵＝針對目前資料夾本身的操作，而且沒有任何被選取的項目。 */
function openBlankMenu(event: MouseEvent) {
  if (isChrome(event.target)) {
    return;
  }
  tabs.setActivePane(props.paneId);
  if (!pane.value.currentPath) {
    return;
  }
  menu.value = {
    x: event.clientX,
    y: event.clientY,
    request: blankRequest(props.paneId, pane.value.currentPath),
    extended: event.shiftKey,
    stage: "main",
  };
}

async function onMenuSelect(id: string) {
  const current = menu.value;
  if (!current) {
    return;
  }

  // 「加入我的資料夾」：先挑容器；清單上沒有虛擬目錄就直接進第一層。
  if (id === ADD_TO_FOLDERS_ID) {
    if (!addToFolders.needsContainerPick()) {
      menu.value = null;
      await addToFolders.add(current.request.target.path, TREE_ROOT_CONTAINER);
      return;
    }
    menu.value = { ...current, stage: "container" };
    return;
  }

  // 「重新命名」是就地編輯，不是 usePathMenu 動作表裡的一項。
  if (id === "rename") {
    menu.value = null;
    startRename(current.request.target.path);
    return;
  }

  menu.value = null;
  if (current.stage === "container") {
    const containerId = addToFolders.containerOf(id);
    if (containerId !== null) {
      await addToFolders.add(current.request.target.path, containerId);
    }
    return;
  }
  await runMenu(id, current.request);
}

/** 開始就地重新命名；清單裡找不到這一列（被搜尋篩掉、或在別的資料夾）就不做。 */
function startRename(path: string) {
  if (clipboard.busy) {
    return;
  }
  const entry = rows.value.find((item) => samePath(item.path, path));
  if (!entry) {
    return;
  }
  // 貼上後自動進入編輯時，那一列原本沒有被選取；先選起來才與檔案總管一致。
  explorer.select(props.paneId, entry.path, "replace");
  renaming.value = { path: entry.path, originalName: entry.name };
}

/** 就地編輯送出：名稱清空或沒變都當成取消，不叫後端。 */
async function commitRename(value: string) {
  const state = renaming.value;
  renaming.value = null;
  if (!state) {
    return;
  }
  const name = value.trim();
  if (!name || name === state.originalName) {
    return;
  }
  await clipboard.renameEntry(props.paneId, state.path, name);
}

function cancelRename() {
  renaming.value = null;
}

// F2：對焦點列開始就地重新命名；貼上產生的「- 複製」則指名那一列（見 `clipboard.paste`）。
// 兩者都只有焦點窗格反應。
watch(
  () => ui.renameRequest,
  (request) => {
    if (request.paneId && request.paneId !== props.paneId) {
      return;
    }
    if (props.paneId !== tabs.activePaneId) {
      return;
    }
    if (request.path) {
      startRename(request.path);
      return;
    }
    const entry = explorer.focusedEntry(props.paneId);
    if (entry) {
      startRename(entry.path);
    }
  },
);

// 換資料夾時結束編輯，避免舊的編輯狀態在回到同一個資料夾時又冒出來。
watch(
  () => pane.value.currentPath,
  () => {
    renaming.value = null;
  },
);

function sortBy(column: ColumnId) {
  if (SORTABLE.includes(column)) {
    explorer.applySort(props.paneId, column as SortKey);
  }
}
</script>

<template>
  <div
    class="relative flex min-h-0 min-w-0 flex-1 flex-col"
    :style="{ '--file-columns': gridTemplate, '--row-height': `${rowHeight}px` }"
  >
    <div
      ref="scroll"
      class="scroll-area min-h-0 flex-1 overflow-auto bg-canvas"
      @scroll="onScroll"
      @pointerdown="onPointerDown"
      @contextmenu.prevent="openBlankMenu"
    >
      <!-- 表頭跟內容共用同一個捲動容器：水平捲動時一起移動，垂直捲動時固定在頂端。 -->
      <div
        data-header
        class="file-grid sticky top-0 z-10 h-7 border-b border-line bg-surface pr-3 pl-2.5 text-sm text-ink-muted"
        :style="contentWidthStyle"
      >
        <div
          v-for="(column, index) in settings.columns"
          :key="column"
          class="group relative flex h-full min-w-0 items-center"
          :class="index < settings.columns.length - 1 ? 'border-r border-line' : ''"
        >
          <button
            type="button"
            class="flex h-full min-w-0 flex-1 items-center gap-1 rounded px-1 text-left pressable enabled:hover:text-ink disabled:cursor-default"
            :class="column === 'size' ? 'justify-end' : ''"
            :disabled="!SORTABLE.includes(column)"
            @click="sortBy(column)"
          >
            <span class="truncate">{{ COLUMN_LABELS[column] }}</span>
            <AppIcon
              v-if="pane.sortKey === column"
              :name="pane.sortDirection === 'asc' ? 'chevronUp' : 'chevronDown'"
              :size="11"
              class="shrink-0 text-accent"
            />
          </button>

          <!--
            欄寬拖曳把手：1:1 跟手，雙擊自動調整到最寬內容、Alt+雙擊回復預設寬度。
            這裡刻意不畫線 —— 把手置中在格線上，1px 的線在非整數縮放下會落到
            格線左邊，讓表頭那條線看起來比資料列的粗且偏移。改用左右對稱的
            底色提示（w-2 / -right-1），只表達「這裡可以抓」與「這欄改過」。
          -->
          <div
            class="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize pressable"
            :class="
              resizing === column
                ? 'bg-accent/50'
                : 'bg-transparent hover:bg-accent/25'
            "
            :title="`拖曳調整「${COLUMN_LABELS[column]}」欄寬；雙擊自動調到最寬內容，Alt+雙擊回復預設`"
            @pointerdown="startResize(column, $event)"
            @dblclick="fitColumn(column, $event)"
          />
        </div>
      </div>

      <div class="relative" :style="{ height: `${totalHeight}px` }">
        <!-- 空白處拖曳的框選矩形；座標是「列容器」座標，所以會隨捲動一起移動。 -->
        <div
          v-if="marquee"
          class="pointer-events-none absolute z-20 rounded-sm border border-accent bg-accent/15"
          :style="{
            left: `${marquee.left}px`,
            top: `${marquee.top}px`,
            width: `${marquee.width}px`,
            height: `${marquee.height}px`,
          }"
        />
        <div
          class="absolute top-0 left-0"
          :style="[contentWidthStyle, { transform: `translateY(${offsetY}px)` }]"
        >
          <FileTableRow
            v-for="(entry, index) in slice"
            :key="entry.path"
            :entry="entry"
            :columns="settings.columns"
            :selected="pane.selected.includes(entry.path)"
            :focused="pane.focusedIndex === start + index"
            :cut="clipboard.isCut(entry.path)"
            :compare-state="compare.statusFor(props.paneId, entry)"
            :editing="renaming?.path === entry.path"
            :data-index="start + index"
            @activate="syncedNav.open(props.paneId, entry)"
            @contextmenu="openRowMenu(entry, $event)"
            @rename="commitRename"
            @rename-cancel="cancelRename"
          />
        </div>
      </div>

      <EmptyState v-if="isEmpty" :title="emptyTitle" :description="emptyDescription" />

      <div v-if="pane.status === 'loading' && !rows.length" class="px-4 py-6 text-center">
        <p class="text-sm text-ink-faint">正在讀取…</p>
      </div>
    </div>

    <div
      v-if="pane.truncated"
      class="shrink-0 border-t border-line bg-surface-muted px-3 py-1.5 text-xs text-ink-muted"
    >
      項目過多，僅顯示前 {{ formatCount(rows.length) }} 筆。
    </div>

    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      @select="onMenuSelect"
      @close="menu = null"
    />
  </div>
</template>
