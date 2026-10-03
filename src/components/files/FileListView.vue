<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ContextMenu from "@/components/overlays/ContextMenu.vue";
import FileTableRow from "./FileTableRow.vue";
import { usePathMenu } from "@/composables/usePathMenu";
import { useDragGesture } from "@/composables/useDragGesture";
import { useExplorerStore } from "@/stores/explorer";
import { COLUMN_DEFAULTS, COLUMN_MIN, useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import type { ColumnId, FileEntry, PaneId, SortKey } from "@/types/fs";
import { formatCount } from "@/utils/format";

const props = defineProps<{ paneId: PaneId }>();

const explorer = useExplorerStore();
const settings = useSettingsStore();
const tabs = useTabsStore();
const pathMenu = usePathMenu();

const ROW_HEIGHT = 30;
const OVERSCAN = 6;

const pane = computed(() => explorer.meta(props.paneId)!);
const rows = explorer.visibleRef(props.paneId);

const scrollEl = useTemplateRef<HTMLElement>("scroll");
const scrollTop = ref(0);
const viewportHeight = ref(0);
const viewportWidth = ref(0);

let observer: ResizeObserver | null = null;

onMounted(() => {
  const element = scrollEl.value;
  if (!element) {
    return;
  }
  viewportHeight.value = element.clientHeight;
  viewportWidth.value = element.clientWidth;
  observer = new ResizeObserver(() => {
    viewportHeight.value = element.clientHeight;
    viewportWidth.value = element.clientWidth;
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
  `${settings.columns.map((column) => `${settings.columnWidth(column)}px`).join(" ")} minmax(0, 1fr)`,
);

const resizing = ref<ColumnId | null>(null);
let widthAtDragStart = 0;

/** 可拖曳的最大寬度：不能把其他欄位推出畫面。 */
function maxWidthFor(column: ColumnId): number {
  const others = settings.columns
    .filter((id) => id !== column)
    .reduce((sum, id) => sum + settings.columnWidth(id), 0);
  return Math.max(COLUMN_MIN[column], viewportWidth.value - others - 48);
}

const columnDrag = useDragGesture({
  onStart: () => {
    widthAtDragStart = resizing.value ? settings.columnWidth(resizing.value) : 0;
    document.body.style.cursor = "col-resize";
  },
  onMove: (state) => {
    if (!resizing.value) {
      return;
    }
    const next = Math.min(widthAtDragStart + state.dx, maxWidthFor(resizing.value));
    settings.setColumnWidth(resizing.value, next);
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

const start = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN));
const end = computed(() =>
  Math.min(rows.value.length, Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + OVERSCAN),
);
const slice = computed(() => rows.value.slice(start.value, end.value));
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

/** 點擊空白處才清除選取；點到列由列自己處理。 */
function onBlankClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest("[data-row]")) {
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
    if (top < element.scrollTop) {
      element.scrollTop = top;
    } else if (bottom > element.scrollTop + element.clientHeight) {
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

const menuItems = computed(() => (menu.value?.kind === "file" ? pathMenu.fileMenu : pathMenu.folderMenu));

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
  if ((event.target as HTMLElement).closest("[data-row]")) {
    return;
  }
  tabs.setActivePane(props.paneId);
  if (!pane.value.currentPath) {
    return;
  }
  menu.value = { x: event.clientX, y: event.clientY, path: pane.value.currentPath, kind: "folder" };
}

async function onMenuSelect(id: string) {
  const target = menu.value?.path;
  menu.value = null;
  if (target) {
    await pathMenu.run(id, target);
  }
}

function sortBy(column: ColumnId) {
  if (SORTABLE.includes(column)) {
    explorer.applySort(props.paneId, column as SortKey);
  }
}
</script>

<template>
  <div class="relative flex min-h-0 min-w-0 flex-1 flex-col" :style="{ '--file-columns': gridTemplate }">
    <div class="file-grid h-8 shrink-0 border-b border-line bg-surface pr-3 pl-2.5 text-[12px] text-ink-muted">
      <div
        v-for="column in settings.columns"
        :key="column"
        class="group relative flex h-full min-w-0 items-center"
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

        <!-- 欄寬拖曳把手：1:1 跟手，雙擊回復預設寬度。 -->
        <div
          class="absolute top-0 -right-[3px] z-10 h-full w-[7px] cursor-col-resize"
          :title="`拖曳調整「${COLUMN_LABELS[column]}」欄寬，雙擊回復預設`"
          @pointerdown="startResize(column, $event)"
          @dblclick="settings.resetColumnWidth(column)"
        >
          <div
            class="mx-auto h-full w-px transition-colors duration-100"
            :class="
              resizing === column
                ? 'bg-accent'
                : settings.columnWidth(column) !== COLUMN_DEFAULTS[column]
                  ? 'bg-line-strong group-hover:bg-accent'
                  : 'bg-transparent group-hover:bg-line-strong'
            "
          />
        </div>
      </div>
    </div>

    <div
      ref="scroll"
      class="scroll-area min-h-0 flex-1 overflow-y-auto bg-canvas"
      @scroll="onScroll"
      @click="onBlankClick"
      @contextmenu.prevent="openBlankMenu"
    >
      <div class="relative" :style="{ height: `${totalHeight}px` }">
        <div class="absolute inset-x-0 top-0" :style="{ transform: `translateY(${offsetY}px)` }">
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
