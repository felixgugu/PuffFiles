<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import FloatingPanel from "./FloatingPanel.vue";
import { useViewerSearch } from "@/composables/useViewerSearch";
import { useSettingsStore } from "@/stores/settings";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import type { SearchOptions } from "@/utils/textSearch";

/**
 * 檢視器搜尋面板：標題列由 `FloatingPanel` 提供，這裡只放搜尋框、
 * 三個選項、命中索引／數量與命中清單。搜尋與標記都在 `useViewerSearch`。
 */
const props = withDefaults(
  defineProps<{
    paneId: PaneId;
    /** 面板定位容器（檢視器根節點）。 */
    host: HTMLElement | null;
    /** 搜尋內容根節點（文字節點所在）。 */
    root: HTMLElement | null;
    /** 內容變動訊號：換檔、重新渲染、iframe 載入完成。 */
    source: unknown;
    /** 命中列是否顯示行號（純文字／程式碼）。 */
    showLine?: boolean;
  }>(),
  { showLine: false },
);

const viewer = useViewerStore();
const settings = useSettingsStore();
const search = useViewerSearch({
  paneId: props.paneId,
  root: () => props.root,
  source: () => props.source,
  showLine: props.showLine,
});

const FLAGS: { id: keyof SearchOptions; label: string; title: string }[] = [
  { id: "caseSensitive", label: "Aa", title: "大小寫須相符" },
  { id: "wholeWord", label: "全字", title: "只比對完整字詞" },
  { id: "regex", label: ".*", title: "使用 Regex" },
];

const input = useTemplateRef<HTMLInputElement>("input");
const headerEl = useTemplateRef<HTMLElement>("header");
const listEl = useTemplateRef<HTMLElement>("list");
const listHeight = ref(0);

const collapsed = computed(() => settings.viewerSearchCollapsed);

/** 未移動過時避開同一窗格已展開的目錄索引。 */
function avoidToc() {
  return props.host?.querySelector<HTMLElement>('[data-panel="toc"]') ?? null;
}

const counter = computed(() => {
  if (search.result.value.error) {
    return "語法錯誤";
  }
  if (search.result.value.tooLarge) {
    return "內容過大";
  }
  if (!search.query.value) {
    return "";
  }
  if (!search.hits.value.length) {
    return "沒有結果";
  }
  const suffix = search.result.value.truncated ? "+" : "";
  return `${search.activeIndex.value + 1} / ${search.hits.value.length}${suffix}`;
});

const emptyMessage = computed(() => {
  if (search.result.value.tooLarge) {
    return "內容過大，已略過搜尋";
  }
  if (search.result.value.error) {
    return search.result.value.error;
  }
  return search.query.value ? "沒有結果" : "輸入關鍵字開始搜尋";
});

function onInputKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    if (event.shiftKey) {
      search.prev();
    } else {
      search.next();
    }
    return;
  }
  if (event.key === "Escape") {
    // 輸入框的 Esc 只關面板（全域處理器不會收到輸入框的事件，這裡再擋一次保心安）。
    event.preventDefault();
    event.stopPropagation();
    viewer.closeSearch(props.paneId);
  }
}

function onSelect(index: number) {
  search.select(index);
  // 焦點留在搜尋框，Enter／Shift+Enter 才能連續跳。
  input.value?.focus({ preventScroll: true });
}

function measure() {
  listHeight.value =
    (headerEl.value?.offsetHeight ?? 0) + (listEl.value?.scrollHeight ?? 0);
}

watch(
  [listEl, headerEl, () => search.hits.value.length, collapsed],
  () => {
    void nextTick(measure);
  },
  { flush: "post" },
);

/** 目前那一筆若捲出清單可視範圍，把它帶回清單內。 */
watch(
  () => search.activeIndex.value,
  (index) => {
    const list = listEl.value;
    if (index < 0 || !list) {
      return;
    }
    const row = Array.from(list.querySelectorAll<HTMLElement>("[data-search-row]")).find(
      (element) => element.dataset.searchRow === String(index),
    );
    if (!row) {
      return;
    }
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < listRect.top) {
      list.scrollTop += rowRect.top - listRect.top;
    } else if (rowRect.bottom > listRect.bottom) {
      list.scrollTop += rowRect.bottom - listRect.bottom;
    }
  },
);

onMounted(() => {
  void nextTick(measure);
  input.value?.focus();
  input.value?.select();
});
</script>

<template>
  <FloatingPanel
    panel="search"
    title="搜尋"
    icon="search"
    drag-label="搜尋，可拖曳移動；方向鍵移動，Enter 收合或展開"
    resize-label="調整搜尋面板大小；方向鍵調整寬高"
    :host="host"
    :collapsed="collapsed"
    :initial-layout="settings.viewerSearchPanel"
    :content-height="listHeight"
    :avoid="avoidToc"
    @persist="settings.setViewerSearchPanel"
    @toggle-collapse="settings.toggleViewerSearchCollapsed()"
  >
    <div ref="header" class="shrink-0 border-b border-line px-2 py-1.5">
      <div
        class="flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 transition-colors focus-within:border-accent"
      >
        <AppIcon name="search" :size="13" class="shrink-0 text-ink-faint" />
        <input
          ref="input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="搜尋檢視器內容"
          class="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          :value="search.query.value"
          @input="search.setQuery(($event.target as HTMLInputElement).value)"
          @keydown="onInputKeydown"
        />
        <button
          v-if="search.query.value"
          type="button"
          class="shrink-0 rounded p-0.5 text-ink-faint pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
          title="清除搜尋"
          @click="search.setQuery('')"
        >
          <AppIcon name="close" :size="12" />
        </button>
      </div>

      <div class="mt-1.5 flex items-center gap-1">
        <button
          v-for="flag in FLAGS"
          :key="flag.id"
          type="button"
          class="h-6 min-w-6 rounded-md px-1 text-xs pressable"
          :class="
            search.flags.value[flag.id]
              ? 'bg-accent-soft text-accent'
              : 'text-ink-muted hover:bg-surface-hover active:bg-pressed hover:text-ink'
          "
          :aria-pressed="search.flags.value[flag.id]"
          :title="flag.title"
          @click="search.toggleFlag(flag.id)"
        >
          {{ flag.label }}
        </button>

        <span class="ml-auto shrink-0 text-xs tabular-nums text-ink-faint">{{ counter }}</span>
        <button
          type="button"
          class="flex size-6 items-center justify-center rounded-md text-ink-muted pressable enabled:hover:bg-surface-hover enabled:active:bg-pressed enabled:hover:text-ink disabled:opacity-30"
          title="上一個命中 (Shift+Enter)"
          :disabled="!search.hits.value.length"
          @click="search.prev()"
        >
          <AppIcon name="chevronUp" :size="13" />
        </button>
        <button
          type="button"
          class="flex size-6 items-center justify-center rounded-md text-ink-muted pressable enabled:hover:bg-surface-hover enabled:active:bg-pressed enabled:hover:text-ink disabled:opacity-30"
          title="下一個命中 (Enter)"
          :disabled="!search.hits.value.length"
          @click="search.next()"
        >
          <AppIcon name="chevronDown" :size="13" />
        </button>
      </div>
    </div>

    <div ref="list" class="scroll-area min-h-0 flex-1 overflow-y-auto p-1">
      <button
        v-for="(hit, index) in search.hits.value"
        :key="`${hit.start}-${index}`"
        type="button"
        :data-search-row="index"
        class="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs pressable"
        :class="
          index === search.activeIndex.value
            ? 'bg-accent-soft text-accent'
            : 'text-ink-muted hover:bg-surface-hover active:bg-pressed hover:text-ink'
        "
        :aria-current="index === search.activeIndex.value ? 'true' : undefined"
        :title="hit.lineText.text"
        @click="onSelect(index)"
      >
        <span v-if="search.showLine" class="shrink-0 tabular-nums opacity-60">{{
          hit.lineNumber
        }}</span>
        <span class="min-w-0 flex-1 truncate">
          {{ hit.lineText.text.slice(0, hit.lineText.matchStart)
          }}<span class="rounded-[2px] bg-accent-soft px-0.5 font-medium text-ink">{{
            hit.lineText.text.slice(hit.lineText.matchStart, hit.lineText.matchEnd)
          }}</span
          >{{ hit.lineText.text.slice(hit.lineText.matchEnd) }}
        </span>
      </button>

      <p
        v-if="!search.hits.value.length"
        class="px-2 py-3 text-center text-xs leading-relaxed text-ink-faint"
      >
        {{ emptyMessage }}
      </p>
    </div>
  </FloatingPanel>
</template>
