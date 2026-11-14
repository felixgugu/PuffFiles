<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useViewerScroll } from "@/composables/useViewerScroll";
import { useSettingsStore } from "@/stores/settings";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import {
  archiveExtensionOf,
  archiveRows,
  filterArchiveRows,
  formatArchiveTime,
  MAX_ARCHIVE_ENTRIES,
  sortArchiveRows,
  type ArchiveSortKey,
} from "@/utils/archive";
import { colorFor, iconFor } from "@/utils/fileKind";
import { formatBytes, formatCount } from "@/utils/format";

/**
 * 壓縮檔檢視器（唯讀清單）。
 *
 * 內容由後端呼叫 7-Zip 命令列版列出（`list_archive`），這裡只負責篩選、排序與
 * 虛擬滾動的清單。**不解壓縮、不落地**：要取出檔案請用標頭或右鍵的 7-Zip 工具。
 *
 * 資料夾不另外列一列：壓縮檔常常根本沒有資料夾項目，名稱欄直接顯示相對路徑
 * （前綴淡色），與檔案清單的「扁平化展示」同一套視覺語言。
 */
const props = defineProps<{ paneId: PaneId }>();

const viewer = useViewerStore();
const settings = useSettingsStore();

const state = computed(() => viewer.of(props.paneId));
const archive = computed(() => state.value?.archive ?? null);
const needsPassword = computed(() => archive.value?.needsPassword === true);

const query = ref("");
const sortKey = ref<ArchiveSortKey>("name");
const sortDirection = ref<"asc" | "desc">("asc");

const rows = computed(() => {
  const source = archiveRows(archive.value?.entries ?? []);
  return sortArchiveRows(
    filterArchiveRows(source, query.value),
    sortKey.value,
    sortDirection.value,
  );
});

function toggleSort(key: ArchiveSortKey) {
  if (sortKey.value === key) {
    sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
    return;
  }
  sortKey.value = key;
  sortDirection.value = "asc";
}

/*
 * 虛擬滾動：與 `FileListView` 同一組參數（列高隨字級縮放、表頭 sticky 且 in-flow）。
 * 壓縮檔可能上萬筆，整份畫出來會拖垮捲動。
 */
const ROW_BASE_HEIGHT = 24;
const HEADER_HEIGHT = 28;
const OVERSCAN = 6;

const rowHeight = computed(() => Math.round(ROW_BASE_HEIGHT * settings.fontScale));

const scrollEl = useTemplateRef<HTMLElement>("scroll");
const scroll = useViewerScroll(props.paneId, scrollEl);
const scrollTop = ref(0);
const viewportHeight = ref(0);

let observer: ResizeObserver | null = null;

/**
 * 量可視高度。
 *
 * 捲動容器不一定一掛載就在：檔頭加密時內容區換成密碼輸入，解鎖後才長出清單，
 * 所以跟著 `scrollEl` 重設，而不是只在 `onMounted` 量一次。
 */
function observeScroll(element: HTMLElement | null) {
  observer?.disconnect();
  observer = null;
  if (!element) {
    viewportHeight.value = 0;
    return;
  }
  viewportHeight.value = element.clientHeight;
  observer = new ResizeObserver(() => {
    viewportHeight.value = element.clientHeight;
  });
  observer.observe(element);
}

watch(scrollEl, observeScroll, { immediate: true, flush: "post" });

onBeforeUnmount(() => observer?.disconnect());

function onScroll() {
  scrollTop.value = scrollEl.value?.scrollTop ?? 0;
  scroll.save();
}

const start = computed(() => {
  const raw =
    Math.floor((scrollTop.value - HEADER_HEIGHT) / rowHeight.value) - OVERSCAN;
  return Math.min(Math.max(0, raw), Math.max(0, rows.value.length - 1));
});
const end = computed(() =>
  Math.min(
    rows.value.length,
    Math.ceil((scrollTop.value + viewportHeight.value - HEADER_HEIGHT) / rowHeight.value) +
      OVERSCAN,
  ),
);
const slice = computed(() => rows.value.slice(start.value, end.value));
const offsetY = computed(() => start.value * rowHeight.value);
const totalHeight = computed(() => rows.value.length * rowHeight.value);

const passwordInput = ref("");

/** 換篩選字串就回到清單最上面：留在中間會看到一片空白（原本的位置已經不在結果裡）。 */
watch(query, () => {
  if (scrollEl.value) {
    scrollEl.value.scrollTop = 0;
  }
  scrollTop.value = 0;
});

function unlock() {
  if (!passwordInput.value) {
    return;
  }
  void viewer.unlockArchive(props.paneId, passwordInput.value);
  // 密碼欄位不保留使用者打過的字（成功就換成清單，失敗就重新輸入）。
  passwordInput.value = "";
}

/** 篩選框的 Esc＝清掉字串（輸入框裡的按鍵本來就不會被全域快速鍵接收）。 */
function onFilterKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && query.value) {
    event.preventDefault();
    event.stopPropagation();
    query.value = "";
  }
}

function entryIcon(row: { entry: { path: string } }) {
  return iconFor({ isDir: false, extension: archiveExtensionOf(row.entry.path), isSymlink: false });
}

function entryColor(row: { entry: { path: string } }) {
  return colorFor({ isDir: false, extension: archiveExtensionOf(row.entry.path) });
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <!-- 檔頭加密：列不出來，先問密碼（密碼只留在這個窗格的記憶體）。 -->
    <div
      v-if="needsPassword"
      class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <AppIcon name="lock" :size="24" class="text-ink-faint" />
      <p class="text-sm text-ink-muted">這個壓縮檔需要密碼才能列出內容</p>
      <div class="flex w-full max-w-xs items-center gap-2">
        <input
          v-model="passwordInput"
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="輸入密碼"
          class="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          @keydown.enter.prevent="unlock"
        />
        <button
          type="button"
          class="shrink-0 rounded-md bg-accent-soft px-2.5 py-1 text-sm text-accent pressable hover:bg-surface-hover"
          @click="unlock"
        >
          解鎖
        </button>
      </div>
      <p class="text-xs text-ink-faint">密碼只用於這次列舉，不會寫進任何紀錄。</p>
    </div>

    <template v-else>
      <div class="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
        <AppIcon name="search" :size="13" class="shrink-0 text-ink-faint" />
        <input
          v-model="query"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="篩選項目名稱或路徑"
          class="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          @keydown="onFilterKeydown"
        />
        <span class="shrink-0 text-xs text-ink-faint tabular-nums">
          {{ formatCount(rows.length) }} / {{ formatCount(archive?.entries.length ?? 0) }}
        </span>
      </div>

      <div
        ref="scroll"
        class="scroll-area archive-grid-scope min-h-0 flex-1 overflow-auto bg-canvas"
        @scroll.passive="onScroll"
      >
        <div
          class="archive-grid sticky top-0 z-10 h-7 border-b border-line bg-surface pr-3 pl-2.5 text-sm text-ink-muted"
        >
          <button
            type="button"
            class="flex min-w-0 items-center gap-1 rounded px-1 text-left pressable hover:text-ink"
            @click="toggleSort('name')"
          >
            <span class="truncate">名稱</span>
            <AppIcon
              v-if="sortKey === 'name'"
              :name="sortDirection === 'asc' ? 'chevronUp' : 'chevronDown'"
              :size="11"
              class="shrink-0 text-accent"
            />
          </button>
          <button
            type="button"
            class="flex justify-end gap-1 rounded px-1 pressable hover:text-ink"
            @click="toggleSort('size')"
          >
            <span>大小</span>
            <AppIcon
              v-if="sortKey === 'size'"
              :name="sortDirection === 'asc' ? 'chevronUp' : 'chevronDown'"
              :size="11"
              class="shrink-0 text-accent"
            />
          </button>
          <span class="flex justify-end px-1">壓縮後</span>
          <button
            type="button"
            class="flex min-w-0 items-center gap-1 rounded px-1 text-left pressable hover:text-ink"
            @click="toggleSort('modified')"
          >
            <span class="truncate">修改時間</span>
            <AppIcon
              v-if="sortKey === 'modified'"
              :name="sortDirection === 'asc' ? 'chevronUp' : 'chevronDown'"
              :size="11"
              class="shrink-0 text-accent"
            />
          </button>
        </div>

        <div class="relative" :style="{ height: `${totalHeight}px` }">
          <div class="absolute inset-x-0 top-0" :style="{ transform: `translateY(${offsetY}px)` }">
            <div
              v-for="row in slice"
              :key="row.key"
              class="archive-grid border-b border-line/40 hover:bg-surface-hover"
              :style="{ height: `${rowHeight}px` }"
              :title="row.entry.path"
            >
              <div class="flex min-w-0 items-center gap-1.5 px-2.5">
                <AppIcon
                  :name="entryIcon(row)"
                  :size="14"
                  :class="entryColor(row)"
                  class="shrink-0"
                />
                <span class="flex min-w-0 items-center">
                  <!--
                    前綴與檔名是同一個路徑的兩段，包在一起、中間不留 gap；前綴的
                    `flex-shrink` 給得比檔名大很多 —— 欄位不夠寬時先吃掉前綴。
                  -->
                  <span
                    v-if="row.folder"
                    class="min-w-0 truncate text-xs text-ink-faint"
                    :style="{ flexShrink: 20 }"
                    >{{ row.folder }}</span
                  >
                  <span class="min-w-0 truncate text-sm text-ink">{{ row.name }}</span>                </span>
                <AppIcon
                  v-if="row.entry.encrypted"
                  name="lock"
                  :size="11"
                  class="shrink-0 text-ink-faint"
                />
              </div>
              <div class="flex items-center justify-end px-1 text-sm tabular-nums text-ink-muted">
                {{ formatBytes(row.entry.size) }}
              </div>
              <div class="flex items-center justify-end px-1 text-sm tabular-nums text-ink-faint">
                {{ formatBytes(row.entry.packedSize) }}
              </div>
              <div class="flex items-center px-1 text-xs tabular-nums text-ink-faint">
                {{ formatArchiveTime(row.entry.modified) }}
              </div>
            </div>
          </div>
        </div>

        <p
          v-if="!rows.length"
          class="px-4 py-10 text-center text-sm text-ink-faint"
        >
          {{ query ? "沒有符合的項目" : "這個壓縮檔裡沒有檔案" }}
        </p>
      </div>

      <div
        class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-surface-muted px-3 py-1.5 text-xs text-ink-muted"
      >
        <span>{{ formatCount(archive?.entries.length ?? 0) }} 個項目</span>
        <span aria-hidden="true">·</span>
        <span>原始 {{ formatBytes(archive?.totalSize ?? 0) }}</span>
        <span aria-hidden="true">·</span>
        <span>壓縮後 {{ formatBytes(archive?.totalPackedSize ?? 0) }}</span>
        <span v-if="archive?.encrypted" aria-hidden="true">·</span>
        <span v-if="archive?.encrypted">含加密項目</span>
        <span v-if="archive?.truncated" class="text-ink-faint">
          · 已達 {{ formatCount(MAX_ARCHIVE_ENTRIES) }} 筆上限，只列前段
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
 * 四欄的固定軌道：名稱吃剩下的寬度，其餘三欄固定（大小／壓縮後／修改時間）。
 * 表頭與資料列共用同一組欄寬，捲動時才不會錯位。
 */
.archive-grid-scope {
  --archive-columns: minmax(0, 1fr) 92px 92px 148px;
}

.archive-grid {
  display: grid;
  grid-template-columns: var(--archive-columns);
  align-items: center;
}
</style>
