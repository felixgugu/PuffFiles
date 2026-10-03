<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ContextMenu from "@/components/overlays/ContextMenu.vue";
import FileTableRow from "./FileTableRow.vue";
import { useDragGesture } from "@/composables/useDragGesture";
import { usePathMenu } from "@/composables/usePathMenu";
import { useExplorerStore } from "@/stores/explorer";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import type { ColumnId, FileEntry, PaneId, SortKey } from "@/types/fs";
import { formatCount } from "@/utils/format";

const props = defineProps<{ paneId: PaneId }>();

const explorer = useExplorerStore();
const settings = useSettingsStore();
const tabs = useTabsStore();
const { fileMenu, folderMenu, run: runMenu } = usePathMenu();

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

function onBlankClick(event: MouseEvent) {
  if (isChrome(event.target)) {
    return;
  }
  explorer.clearSelection(props.paneId);
}

function onRowSelect(entry: FileEntry, event: MouseEvent) {
  tabs.setActivePane(props.paneId);
  const mode = event.ctrlKey || event.metaKey ? "toggle" : event.shiftKey ? "range" : "replace";
  explorer.select(props.paneId, entry.path, mode);
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
  path: string;
  kind: "file" | "folder";
}

const menu = ref<MenuState | null>(null);

const menuItems = computed(() => (menu.value?.kind === "file" ? fileMenu.value : folderMenu.value));

function openRowMenu(entry: FileEntry, event: MouseEvent) {
  tabs.setActivePane(props.paneId);
  if (!pane.value.selected.includes(entry.path)) {
    explorer.select(props.paneId, entry.path);
  }
  menu.value = {
    x: event.clientX,
    y: event.clientY,
    path: entry.path,
    kind: entry.isDir ? "folder" : "file",
  };
}

/** 空白處右鍵＝針對目前資料夾本身的操作。 */
function openBlankMenu(event: MouseEvent) {
  if (isChrome(event.target)) {
    return;
  }
  tabs.setActivePane(props.paneId);
  if (!pane.value.currentPath) {
    return;
  }
  menu.value = { x: event.clientX, y: event.clientY, path: pane.value.currentPath, kind: "folder" };
}

async function onMenuSelect(id: string) {
  const current = menu.value;
  menu.value = null;
  if (current) {
    await runMenu(id, { path: current.path, isDir: current.kind === "folder" });
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
      @click="onBlankClick"
      @contextmenu.prevent="openBlankMenu"
    >
      <!-- 表頭跟內容共用同一個捲動容器：水平捲動時一起移動，垂直捲動時固定在頂端。 -->
      <div
        data-header
        class="file-grid sticky top-0 z-10 h-7 border-b border-line bg-surface pr-3 pl-2.5 text-[12px] text-ink-muted"
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
            class="flex h-full min-w-0 flex-1 items-center gap-1 rounded px-1 text-left transition-colors duration-75 enabled:hover:text-ink disabled:cursor-default"
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
            class="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize transition-colors duration-100"
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
            @select="onRowSelect(entry, $event)"
            @activate="explorer.activate(props.paneId, entry)"
            @contextmenu="openRowMenu(entry, $event)"
          />
        </div>
      </div>

      <EmptyState v-if="isEmpty" :title="emptyTitle" :description="emptyDescription" />

      <div v-if="pane.status === 'loading' && !rows.length" class="px-4 py-6 text-center">
        <p class="text-xs text-ink-faint">正在讀取…</p>
      </div>
    </div>

    <div
      v-if="pane.truncated"
      class="shrink-0 border-t border-line bg-surface-muted px-3 py-1.5 text-[11px] text-ink-muted"
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
