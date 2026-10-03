<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useExplorerStore } from "@/stores/explorer";
import { useHistoryStore } from "@/stores/history";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";

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
  return history.items.filter((item) => item.path.toLocaleLowerCase().includes(query));
});

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
function open(path: string, event: MouseEvent) {
  const tab = tabs.activeTab;
  const target = event.altKey && tab ? (tabs.otherPaneId(tab) ?? tab.activePaneId) : tabs.activePaneId;
  if (target) {
    void explorer.navigate(target, path);
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
          class="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
          @keydown.esc.prevent="ui.historyOpen = false"
        />
        <span class="shrink-0 text-[11px] text-ink-faint">{{ history.items.length }}/100</span>
      </div>

      <div class="scroll-area min-h-0 flex-1 overflow-y-auto py-1">
        <button
          v-for="item in filtered"
          :key="item.path"
          type="button"
          class="group flex w-full items-baseline gap-3 px-3 py-1.5 text-left transition-colors duration-75 hover:bg-surface-hover"
          :title="item.path"
          @click="open(item.path, $event)"
        >
          <span class="min-w-0 shrink-0 max-w-40 truncate text-[13px] text-ink">{{ item.name }}</span>
          <span class="min-w-0 flex-1 truncate text-[11px] text-ink-faint">{{ item.path }}</span>
          <span
            class="shrink-0 rounded px-1 text-[11px] text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
            title="從紀錄移除"
            @click.stop="history.remove(item.path)"
          >
            <AppIcon name="close" :size="11" />
          </span>
        </button>

        <p v-if="!filtered.length" class="px-3 py-6 text-center text-xs text-ink-faint">
          {{ history.items.length ? "沒有符合的紀錄" : "還沒有瀏覽紀錄" }}
        </p>
      </div>

      <div v-if="history.items.length" class="flex shrink-0 items-center justify-between border-t border-line px-3 py-1.5">
        <span class="text-[11px] text-ink-faint">Alt+點擊可在另一個窗格開啟</span>
        <button
          type="button"
          class="rounded px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-hover hover:text-ink"
          @click="history.clear()"
        >
          清空紀錄
        </button>
      </div>
    </div>
  </Transition>
</template>
