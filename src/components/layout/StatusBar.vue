<script setup lang="ts">
import { computed } from "vue";
import { isDesktopRuntime } from "@/services/api";
import { useCompareStore } from "@/stores/compare";
import { useExplorerStore } from "@/stores/explorer";
import { useTabsStore } from "@/stores/tabs";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import { formatBytes, formatCount } from "@/utils/format";
import { paneSlotLabel } from "@/utils/layout";

/**
 * 狀態列：不論單窗或分割，排列一律是「完整路徑靠左、其他資訊靠右」。
 *
 * 分割時一個窗格一行（點一行即可切換到該窗格），單窗時就是同樣排列的一行。
 */
const explorer = useExplorerStore();
const tabs = useTabsStore();
const viewer = useViewerStore();
const compare = useCompareStore();

const isMock = !isDesktopRuntime();

const paneIds = computed<PaneId[]>(() => tabs.activeTab?.paneIds ?? []);
const isSplit = computed(() => paneIds.value.length > 1);
const activePane = computed(() => explorer.meta(tabs.activePaneId));

function summaryOf(paneId: PaneId, withFilterHint: boolean): string {
  const viewing = viewer.of(paneId);
  if (viewing) {
    const parts = [viewing.name];
    if (viewing.size > 0) {
      parts.push(formatBytes(viewing.size));
    }
    if (viewing.encoding) {
      parts.push(viewing.encoding);
    }
    return `檢視中：${parts.join(" · ")}`;
  }
  const selection = explorer.selectionSummary(paneId);
  if (selection.count > 0) {
    return `已選取 ${formatCount(selection.count)} 個項目 · ${formatBytes(selection.size)}`;
  }
  const total = formatCount(explorer.visibleRef(paneId)?.value.length ?? 0);
  const filtering = withFilterHint && explorer.meta(paneId)?.query.trim();
  return filtering ? `${total} 個符合的項目` : `${total} 個項目`;
}

const singleSummary = computed(() => summaryOf(tabs.activePaneId, true));

/**
 * 目錄比對的統計（見 §同步瀏覽與目錄比對）；顏色語意寫在 tooltip。
 * 關閉比對或沒有分割時回空字串，那一行就只顯示原本的項目數。
 */
function compareSummaryOf(paneId: PaneId): string {
  if (!compare.enabled) {
    return "";
  }
  const counts = compare.counts(paneId);
  return `僅此窗格 ${formatCount(counts.only)} · 不同 ${formatCount(counts.different)}`;
}

const singleCompare = computed(() => compareSummaryOf(tabs.activePaneId));

interface StatusRow {
  id: PaneId;
  label: string;
  path: string;
  active: boolean;
  loading: boolean;
  summary: string;
  compare: string;
}

const rows = computed<StatusRow[]>(() => {
  const layout = tabs.activeTab;
  return paneIds.value.map((id) => {
    const meta = explorer.meta(id);
    return {
      id,
      label: layout ? paneSlotLabel(layout, id) : "",
      path: meta?.currentPath ?? "",
      active: tabs.activePaneId === id,
      loading: meta?.status === "loading",
      summary: summaryOf(id, false),
      compare: compareSummaryOf(id),
    };
  });
});
</script>

<template>
  <footer class="flex shrink-0 flex-col border-t border-line bg-chrome text-xs text-ink-muted">
    <!-- 分割：一個窗格一行 -->
    <template v-if="isSplit">
      <button
        v-for="(row, index) in rows"
        :key="row.id"
        type="button"
        class="flex h-[22px] w-full items-center gap-2 px-3 text-left pressable hover:bg-surface-hover active:bg-pressed"
        :class="row.active ? 'text-ink' : 'text-ink-faint'"
        :title="row.path"
        @click="tabs.setActivePane(row.id)"
      >
        <span
          class="shrink-0 rounded px-1.5 text-2xs"
          :class="row.active ? 'bg-accent-soft text-accent' : 'bg-surface-muted'"
        >
          {{ row.label }}
        </span>
        <span class="min-w-0 flex-1 truncate">{{ row.path }}</span>
        <span v-if="row.loading" class="shrink-0 text-accent">正在讀取…</span>
        <span
          v-if="isMock && index === rows.length - 1"
          class="shrink-0 rounded bg-amber-500/15 px-1.5 text-amber-800 dark:text-amber-400"
        >
          瀏覽器預覽模式
        </span>
        <span
          v-if="row.compare"
          class="shrink-0 tabular-nums"
          title="目錄比對：綠＝只在這一邊、琥珀＝兩邊都有但大小或修改時間不同"
        >
          {{ row.compare }}
        </span>
        <span class="shrink-0 tabular-nums">{{ row.summary }}</span>
      </button>
    </template>

    <!-- 單窗：同樣的排列，只是少掉位置標籤 -->
    <div v-else class="flex h-7 items-center gap-2 px-3">
      <span class="min-w-0 flex-1 truncate" :title="activePane?.currentPath">
        {{ activePane?.currentPath }}
      </span>
      <span v-if="activePane?.status === 'loading'" class="shrink-0 text-accent">正在讀取…</span>
      <span
        v-if="isMock"
        class="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-800 dark:text-amber-400"
      >
        瀏覽器預覽模式
      </span>
      <span
        v-if="singleCompare"
        class="shrink-0 tabular-nums"
        title="目錄比對：綠＝只在這一邊、琥珀＝兩邊都有但大小或修改時間不同"
      >
        {{ singleCompare }}
      </span>
      <span class="shrink-0 tabular-nums">{{ singleSummary }}</span>
    </div>
  </footer>
</template>
