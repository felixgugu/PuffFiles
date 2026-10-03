<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ContextMenu from "@/components/overlays/ContextMenu.vue";
import FileTableRow from "./FileTableRow.vue";
import { useDragGesture } from "@/composables/useDragGesture";
import { usePathMenu } from "@/composables/usePathMenu";
import { useClipboardStore } from "@/stores/clipboard";
import { useExplorerStore } from "@/stores/explorer";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import type { MenuRequest } from "@/composables/usePathMenu";
import type { ColumnId, FileEntry, PaneId, SortKey } from "@/types/fs";
import { formatCount } from "@/utils/format";

const props = defineProps<{ paneId: PaneId }>();

const explorer = useExplorerStore();
const settings = useSettingsStore();
const tabs = useTabsStore();
const clipboard = useClipboardStore();
const { menuFor, requestFor, blankRequest, run: runMenu } = usePathMenu();

const ROW_HEIGHT = 24;
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

const start = computed(() =>
  Math.max(0, Math.floor((scrollTop.value - HEADER_HEIGHT) / ROW_HEIGHT) - OVERSCAN),
);
const end = computed(() =>
  Math.min(
    rows.value.length,
    Math.ceil((scrollTop.value + viewportHeight.value - HEADER_HEIGHT) / ROW_HEIGHT) + OVERSCAN,
  ),
);
const slice = computed(() => rows.value.slice(start.value, Math.max(end.value, 0)));
const offsetY = computed(() => start.value * ROW_HEIGHT);
const totalHeight = computed(() => rows.value.length * ROW_HEIGHT);

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
  const raw = Math.floor(contentY / ROW_HEIGHT);
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
    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
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
}

const menu = ref<MenuState | null>(null);

const menuItems = computed(() => (menu.value ? menuFor(menu.value.request) : []));

function openRowMenu(entry: FileEntry, event: MouseEvent) {
  tabs.setActivePane(props.paneId);
  if (!pane.value.selected.includes(entry.path)) {
    explorer.select(props.paneId, entry.path);
  }
  menu.value = {
    x: event.clientX,
    y: event.clientY,
    request: requestFor(props.paneId, { path: entry.path, isDir: entry.isDir }),
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
    request: blankRequest(pane.value.currentPath),
  };
}

async function onMenuSelect(id: string) {
  const current = menu.value;
  menu.value = null;
  if (current) {
    await runMenu(id, current.request);
  }
}

function sortBy(column: ColumnId) {
  if (SORTABLE.includes(column)) {
    explorer.applySort(props.paneId, column as SortKey);
  }
}
</script>

<template>
  <div
    class="relative flex min-h-0 min-w-0 flex-1 flex-col"
    :style="{ '--file-columns': gridTemplate, '--row-height': `${ROW_HEIGHT}px` }"
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
            欄寬拖曳把手：1:1 跟手，雙擊回復預設寬度。
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
            :title="`拖曳調整「${COLUMN_LABELS[column]}」欄寬，雙擊回復預設`"
            @pointerdown="startResize(column, $event)"
            @dblclick="explorer.resetColumnWidth(paneId, column)"
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
            :data-index="start + index"
            @activate="explorer.activate(props.paneId, entry)"
            @contextmenu="openRowMenu(entry, $event)"
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
