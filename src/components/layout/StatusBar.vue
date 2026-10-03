<script setup lang="ts">
import { computed } from "vue";
import { isDesktopRuntime } from "@/services/api";
import { useExplorerStore } from "@/stores/explorer";
import { useTabsStore } from "@/stores/tabs";
import type { PaneId } from "@/types/fs";
import { formatBytes, formatCount } from "@/utils/format";
import { paneSlotLabel } from "@/utils/layout";

const explorer = useExplorerStore();
const tabs = useTabsStore();

const isMock = !isDesktopRuntime();

const paneIds = computed<PaneId[]>(() => tabs.activeTab?.paneIds ?? []);
const isSplit = computed(() => paneIds.value.length > 1);

const activePane = computed(() => explorer.meta(tabs.activePaneId));

/** 未分割時的一行摘要。 */
const singleSummary = computed(() => {
  const selection = explorer.selectionSummary(tabs.activePaneId);
  if (selection.count > 0) {
    return `已選取 ${formatCount(selection.count)} 個項目 · ${formatBytes(selection.size)}`;
  }
  const total = formatCount(explorer.visibleRef(tabs.activePaneId)?.value.length ?? 0);
  return activePane.value?.query.trim() ? `${total} 個符合的項目` : `${total} 個項目`;
});

interface StatusRow {
  id: PaneId;
  label: string;
  path: string;
  active: boolean;
  summary: string;
}

/** 分割時：一個窗格一行，各自顯示自己的完整路徑。 */
const rows = computed<StatusRow[]>(() => {
  const layout = tabs.activeTab;
  return paneIds.value.map((id) => {
    const meta = explorer.meta(id);
    const selection = explorer.selectionSummary(id);
    const count = explorer.visibleRef(id)?.value.length ?? 0;
    return {
      id,
      label: layout ? paneSlotLabel(layout, id) : "",
      path: meta?.currentPath ?? "",
      active: tabs.activePaneId === id,
      summary:
        selection.count > 0
          ? `已選取 ${formatCount(selection.count)} 個 · ${formatBytes(selection.size)}`
          : `${formatCount(count)} 個項目`,
    };
  });
});
</script>

<template>
  <footer class="flex shrink-0 flex-col border-t border-line bg-chrome text-[11px] text-ink-muted">
    <!-- 分割：兩行，一行一個窗格的完整路徑。點一行即可切換到那個窗格。 -->
    <template v-if="isSplit">
      <button
        v-for="(row, index) in rows"
        :key="row.id"
        type="button"
        class="flex h-[22px] w-full items-center gap-2 px-3 text-left transition-colors duration-75 hover:bg-surface-hover"
        :class="row.active ? 'text-ink' : 'text-ink-faint'"
        :title="row.path"
        @click="tabs.setActivePane(row.id)"
      >
        <span
          class="shrink-0 rounded px-1.5 text-[10px]"
          :class="row.active ? 'bg-accent-soft text-accent' : 'bg-surface-muted'"
        >
          {{ row.label }}
        </span>
        <span class="min-w-0 flex-1 truncate">{{ row.path }}</span>
        <span class="shrink-0 tabular-nums">{{ row.summary }}</span>
        <span
          v-if="isMock && index === rows.length - 1"
          class="shrink-0 rounded bg-amber-500/15 px-1.5 text-amber-600 dark:text-amber-400"
        >
          瀏覽器預覽模式
        </span>
      </button>
    </template>

    <!-- 未分割：維持原本的一行。 -->
    <div v-else class="flex h-7 items-center justify-between gap-3 px-3">
      <div class="flex min-w-0 items-center gap-2">
        <span class="shrink-0">{{ singleSummary }}</span>
        <span v-if="activePane?.status === 'loading'" class="shrink-0 text-accent">正在讀取…</span>
      </div>

      <div class="flex min-w-0 items-center gap-2">
        <span
          v-if="isMock"
          class="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-600 dark:text-amber-400"
        >
          瀏覽器預覽模式
        </span>
        <span class="truncate" :title="activePane?.currentPath">{{ activePane?.currentPath }}</span>
      </div>
    </div>
  </footer>
</template>
