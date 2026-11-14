<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useSettingsStore } from "@/stores/settings";
import { activeTypeGroups, fileTypeSummary } from "@/utils/fileTypes";

/**
 * 檔案種類快速篩選（搜尋框右邊的漏斗鈕）。
 *
 * 群組與順序來自設定頁的「快速篩選」（`settings.quickFilters`），這裡只負責按鈕、
 * popover 的開關與選取狀態的呈現；篩選本身在 `stores/explorer.ts`（每個窗格一份，
 * 換資料夾仍保留）。多選：再按一次同一個種類＝取消。
 */
const props = defineProps<{
  /** 目前窗格選取的群組 id。 */
  selected: readonly string[];
}>();

const emit = defineEmits<{
  toggle: [id: string];
  clear: [];
}>();

const settings = useSettingsStore();

const open = ref(false);
const root = useTemplateRef<HTMLElement>("root");
const button = useTemplateRef<HTMLButtonElement>("button");

/** 漏斗鈕只畫啟用中的群組（依設定頁的順序）；全部停用時整顆鈕停用。 */
const groups = computed(() => activeTypeGroups(settings.quickFilters));
const hasGroups = computed(() => groups.value.length > 0);
const selectedSet = computed(() => new Set(props.selected));

const title = computed(() => {
  if (!hasGroups.value) {
    return "沒有啟用的快速篩選種類（在設定頁的「快速篩選」開啟）";
  }
  return props.selected.length
    ? `檔案種類篩選：${fileTypeSummary(props.selected, settings.quickFilters)}（點一下調整）`
    : "檔案種類快速篩選";
});

function close() {
  open.value = false;
}

function toggleOpen() {
  if (!hasGroups.value) {
    return;
  }
  open.value = !open.value;
}

/** Esc 關掉並把焦點還給漏斗鈕；`stop` 讓全域的 Esc（關檢視器／清選取）不跟著跑。 */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !open.value) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  close();
  button.value?.focus();
}

/** 點 popover 以外的地方就收起（與右鍵選單同一套做法）。 */
function onWindowPointerDown(event: PointerEvent) {
  if (!open.value) {
    return;
  }
  const target = event.target;
  if (target instanceof Node && root.value?.contains(target)) {
    return;
  }
  close();
}

onMounted(() => window.addEventListener("pointerdown", onWindowPointerDown, true));
onBeforeUnmount(() => window.removeEventListener("pointerdown", onWindowPointerDown, true));
</script>

<template>
  <div ref="root" class="relative shrink-0" @keydown="onKeydown">
    <button
      ref="button"
      type="button"
      class="relative flex size-7 items-center justify-center rounded-md pressable disabled:cursor-default disabled:opacity-30"
      :class="
        selected.length
          ? 'bg-accent-soft text-accent'
          : 'text-ink-muted enabled:hover:bg-surface-hover enabled:active:bg-pressed enabled:hover:text-ink'
      "
      :disabled="!hasGroups"
      aria-haspopup="true"
      :aria-expanded="open"
      :aria-label="title"
      :title="title"
      @click="toggleOpen"
    >
      <AppIcon name="filter" :size="15" />
      <span
        v-if="selected.length"
        class="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-medium leading-none text-accent-ink"
      >
        {{ selected.length }}
      </span>
    </button>

    <div
      v-if="open"
      class="material-menu absolute right-0 top-full z-50 mt-1 w-64 rounded-lg p-2"
      role="group"
      aria-label="檔案種類快速篩選"
    >
      <p class="px-1 pb-1.5 text-xs text-ink-faint">只顯示選取的種類</p>

      <!-- 群組多的時候（自訂＋內建最多 30 組）在面板內捲動，不要長到看不見底部。 -->
      <div class="scroll-area max-h-80 overflow-y-auto">
        <div class="grid grid-cols-2 gap-1">
          <button
            v-for="group in groups"
            :key="group.id"
            type="button"
            class="truncate rounded-full border px-2 py-1 text-xs pressable"
            :class="
              selectedSet.has(group.id)
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line text-ink-muted hover:bg-surface-hover active:bg-pressed hover:text-ink'
            "
            :aria-pressed="selectedSet.has(group.id)"
            :title="group.hint"
            @click="emit('toggle', group.id)"
          >
            {{ group.label }}
          </button>
        </div>
      </div>

      <div class="mt-2 flex items-center justify-between border-t border-line pt-1.5">
        <span class="text-2xs text-ink-faint">
          {{ selected.length ? `已選 ${selected.length} 種` : "沒有篩選" }}
        </span>
        <button
          type="button"
          class="rounded px-1.5 py-0.5 text-xs pressable enabled:hover:bg-surface-hover enabled:hover:text-ink disabled:opacity-30"
          :disabled="selected.length === 0"
          @click="emit('clear')"
        >
          清除篩選
        </button>
      </div>
    </div>
  </div>
</template>
