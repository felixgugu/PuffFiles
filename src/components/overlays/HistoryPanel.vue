<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useExplorerStore } from "@/stores/explorer";
import { useHistoryStore } from "@/stores/history";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import type { HistoryEntry } from "@/types/fs";

const history = useHistoryStore();
const explorer = useExplorerStore();
const tabs = useTabsStore();
const ui = useUiStore();

const keyword = ref("");
const input = useTemplateRef<HTMLInputElement>("input");

const filtered = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase();
  if (!query) {
    return history.items;
  }
  return history.items.filter((item) =>
    item.paths.some((path) => path.toLocaleLowerCase().includes(query)),
  );
});

/** 一筆紀錄的圖示：單窗是資料夾，分割用方向對應的版面圖示。 */
function iconFor(entry: HistoryEntry) {
  if (entry.paths.length < 2) {
    return "folder" as const;
  }
  return entry.direction === "column" ? ("splitRows" as const) : ("splitColumns" as const);
}

watch(
  () => ui.historyOpen,
  async (open) => {
    if (!open) {
      keyword.value = "";
      return;
    }
    await nextTick();
    input.value?.focus();
  },
);

/** Alt+點擊＝在另一個窗格開啟（有分割時）。 */
function open(entry: HistoryEntry, event: MouseEvent) {
  // 兩行的那種是整組分割版面，套用到目前分頁；單一路徑才只換窗格。
  if (entry.paths.length > 1) {
    tabs.applyLayout(entry.paths, entry.direction);
    ui.historyOpen = false;
    return;
  }

  const tab = tabs.activeTab;
  const target = event.altKey && tab ? (tabs.otherPaneId(tab) ?? tab.activePaneId) : tabs.activePaneId;
  if (target && entry.paths[0]) {
    void explorer.navigate(target, entry.paths[0]);
  }
  ui.historyOpen = false;
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-150 ease-out"
    enter-from-class="-translate-y-1 scale-95 opacity-0"
    leave-active-class="transition duration-100 ease-in"
    leave-to-class="-translate-y-1 opacity-0"
  >
    <div
      v-if="ui.historyOpen"
      class="material-menu absolute top-[calc(100%+6px)] right-2 z-40 flex max-h-[70vh] w-96 flex-col overflow-hidden rounded-xl"
    >
      <div class="flex items-center gap-2 border-b border-line px-3 py-2">
        <AppIcon name="history" :size="15" class="text-ink-muted" />
        <input
          ref="input"
          v-model="keyword"
          type="text"
          spellcheck="false"
          placeholder="搜尋瀏覽紀錄"
          class="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none"
          @keydown.esc.prevent="ui.historyOpen = false"
        />
        <span class="shrink-0 text-xs text-ink-faint">{{ history.items.length }}/100</span>
      </div>

      <div class="scroll-area min-h-0 flex-1 overflow-y-auto py-1">
        <button
          v-for="item in filtered"
          :key="item.paths.join('\u0000')"
          type="button"
          class="group flex w-full items-start gap-2.5 px-3 py-1.5 text-left pressable hover:bg-surface-hover active:bg-pressed"
          :title="item.paths.join('\n')"
          @click="open(item, $event)"
        >
          <AppIcon :name="iconFor(item)" :size="14" class="mt-0.5 shrink-0 text-ink-muted" />
          <span class="min-w-0 flex-1">
            <span
              v-for="(path, index) in item.paths"
              :key="path"
              class="block truncate text-sm"
              :class="index === 0 ? 'text-ink' : 'text-ink-muted'"
            >
              {{ path }}
            </span>
          </span>
          <span
            class="shrink-0 rounded px-1 text-xs text-ink-faint opacity-40 transition-opacity hover:text-ink group-hover:opacity-100 group-focus-within:opacity-100"
            title="從紀錄移除"
            @click.stop="history.remove(item)"
          >
            <AppIcon name="close" :size="11" />
          </span>
        </button>

        <p v-if="!filtered.length" class="px-3 py-6 text-center text-sm text-ink-faint">
          {{ history.items.length ? "沒有符合的紀錄" : "還沒有瀏覽紀錄" }}
        </p>
      </div>

      <div v-if="history.items.length" class="flex shrink-0 items-center justify-between border-t border-line px-3 py-1.5">
        <span class="text-xs text-ink-faint">
          兩行的紀錄是分割版面（第一行左／上、第二行右／下），點一下整組還原；Alt+點擊單一路徑可在另一窗格開啟
        </span>
        <button
          type="button"
          class="rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface-hover active:bg-pressed hover:text-ink"
          @click="history.clear()"
        >
          清空紀錄
        </button>
      </div>
    </div>
  </Transition>
</template>
