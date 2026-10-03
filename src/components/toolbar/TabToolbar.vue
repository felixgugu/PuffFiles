<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import SearchField from "@/components/common/SearchField.vue";
import PathBreadcrumb from "./PathBreadcrumb.vue";
import { useExplorerStore } from "@/stores/explorer";
import { useTabsStore } from "@/stores/tabs";
import { paneSlotLabel } from "@/utils/layout";

/**
 * 每個分頁只有一條路徑功能列，永遠指向「目前焦點窗格」。
 *
 * 分割時這條列會跟著使用者點選的窗格自動切換，並用一個位置標籤說明
 * 它現在代表哪一邊 —— 一條列，兩個窗格共用。
 */
const explorer = useExplorerStore();
const tabs = useTabsStore();

const paneId = computed(() => tabs.activePaneId);
const pane = computed(() => explorer.meta(paneId.value));
const slotLabel = computed(() =>
  tabs.activeTab ? paneSlotLabel(tabs.activeTab, paneId.value) : "",
);

/**
 * 版面切換：三個獨立按鈕，永遠同時可見。
 *
 * - 「目前」的那一個用 accent 標示並停用（已經在那裡了，按了也沒事發生）。
 * - 不能用的（未分割時的「一般」）以淡化呈現。
 * - 其餘的都可以按，滑過會有回饋。
 */
const layoutOptions = computed(() => {
  const tab = tabs.activeTab;
  const split = (tab?.paneIds.length ?? 0) > 1;
  const direction = tab?.direction ?? "row";
  const rowActive = split && direction === "row";
  const columnActive = split && direction === "column";

  return [
    {
      id: "single",
      icon: "layoutSingle" as const,
      current: !split,
      enabled: split,
      title: split ? "取消分割，回到單一窗格" : "單一窗格（目前）",
      run: () => tabs.unsplit(),
    },
    {
      id: "row",
      icon: "splitColumns" as const,
      current: rowActive,
      enabled: !rowActive,
      title: rowActive ? "左右分割（目前）" : "左右分割 (Ctrl+\\)",
      run: () => tabs.split("row"),
    },
    {
      id: "column",
      icon: "splitRows" as const,
      current: columnActive,
      enabled: !columnActive,
      title: columnActive ? "上下分割（目前）" : "上下分割 (Ctrl+Shift+\\)",
      run: () => tabs.split("column"),
    },
  ];
});

const navButtons = computed(() => {
  const current = pane.value;
  return [
    {
      icon: "chevronLeft" as const,
      title: "上一頁 (Alt+←)",
      run: (): void => {
        void explorer.goBack(paneId.value);
      },
      enabled: (current?.backStack.length ?? 0) > 0,
    },
    {
      icon: "chevronRight" as const,
      title: "下一頁 (Alt+→)",
      run: (): void => {
        void explorer.goForward(paneId.value);
      },
      enabled: (current?.forwardStack.length ?? 0) > 0,
    },
    {
      icon: "arrowUp" as const,
      title: "上一層 (Backspace)",
      run: (): void => {
        void explorer.goUp(paneId.value);
      },
      enabled: current?.parentPath !== null && current?.parentPath !== undefined,
    },
    {
      icon: "refresh" as const,
      title: "重新整理 (F5)",
      run: (): void => {
        void explorer.refresh(paneId.value);
      },
      enabled: true,
    },
  ];
});

function revealCurrent() {
  const entry = explorer.focusedEntry(paneId.value);
  if (entry) {
    void explorer.reveal(entry);
  }
}
</script>

<template>
  <div
    v-if="pane"
    class="relative flex h-11 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2"
  >
    <!-- 分割時才出現的位置標籤：說明這條路徑現在屬於哪一個窗格。 -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="scale-90 opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="scale-90 opacity-0"
    >
      <span
        v-if="slotLabel"
        class="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent"
        title="這條路徑屬於焦點窗格"
      >
        {{ slotLabel }}
      </span>
    </Transition>

    <div class="flex shrink-0 items-center gap-0.5">
      <button
        v-for="button in navButtons"
        :key="button.title"
        type="button"
        class="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors duration-75 enabled:hover:bg-surface-hover enabled:hover:text-ink disabled:opacity-30"
        :title="button.title"
        :disabled="!button.enabled"
        @click="button.run()"
      >
        <AppIcon :name="button.icon" :size="15" />
      </button>
    </div>

    <PathBreadcrumb class="min-w-0 flex-1" :pane-id="paneId" />

    <SearchField
      :model-value="pane.query"
      class="w-52"
      @update:model-value="explorer.setQuery(paneId, $event)"
    />

    <div class="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        class="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors duration-75 hover:bg-surface-hover hover:text-ink"
        title="在檔案總管中顯示"
        @click="revealCurrent"
      >
        <AppIcon name="externalLink" :size="15" />
      </button>
      <!-- 版面切換：三個選項同時可見，目前的那個用 accent 標示。 -->
      <div class="ml-1 flex items-center gap-0.5 rounded-lg bg-surface-muted p-0.5">
        <button
          v-for="option in layoutOptions"
          :key="option.id"
          type="button"
          class="flex size-6 items-center justify-center rounded-md transition-colors duration-75"
          :class="
            option.current
              ? 'bg-accent-soft text-accent'
              : option.enabled
                ? 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                : 'cursor-default text-ink-faint opacity-30'
          "
          :aria-disabled="option.current || !option.enabled"
          :title="option.title"
          @click="option.current || !option.enabled ? undefined : option.run()"
        >
          <AppIcon :name="option.icon" :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>
