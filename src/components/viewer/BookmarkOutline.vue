<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import OutlinePanel from "./OutlinePanel.vue";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import type { OutlineItem } from "@/types/viewer";

/**
 * 檢視器的書籤目錄（DOCX 與純文字／程式碼）。
 *
 * 面板本身是共用的「目錄索引」（`OutlinePanel`）；這一層只負責書籤才有的東西：
 * 標題、標題列的「加入書籤」按鈕、空清單的說明，以及列上的重新命名／刪除。
 * 書籤的狀態與動作都在 `composables/useViewerBookmarks.ts`。
 */
const props = defineProps<{
  paneId: PaneId;
  host: HTMLElement | null;
  items: OutlineItem[];
  activeId: string | null;
  /** 目前有沒有選取範圍可以加入書籤（沒有就停用加入鈕）。 */
  canAdd: boolean;
}>();

const emit = defineEmits<{
  jump: [id: string];
  rename: [id: string];
  remove: [id: string];
  add: [];
}>();

const viewer = useViewerStore();

/**
 * DOCX 的頁面固定白紙（不隨主題反轉），所以面板也固定用淺色：深色主題下深色面板
 * 疊在白紙上，字會看不見（見 `main.css` 的 `panel-light`）。
 */
const light = computed(() => viewer.of(props.paneId)?.kind === "docx");

const EMPTY_TEXT = "在內容裡選取文字後按「加入書籤」（或 Ctrl+B），就會列在這裡，並記住那一段的位置。";
</script>

<template>
  <OutlinePanel
    :pane-id="paneId"
    title="書籤目錄"
    :items="items"
    :active-id="activeId"
    :host="host"
    :light="light"
    editable
    :empty-text="EMPTY_TEXT"
    @jump="emit('jump', $event)"
    @rename="emit('rename', $event)"
    @remove="emit('remove', $event)"
  >
    <template #actions>
      <!--
        `@mousedown.prevent`：按下時不要讓焦點離開內文，選取範圍才留得住 ——
        這個按鈕的輸入就是「使用者剛剛選的那段文字」。
      -->
      <button
        type="button"
        class="flex size-6 shrink-0 items-center justify-center rounded-md pressable disabled:opacity-30"
        :class="
          canAdd
            ? 'text-ink-muted hover:bg-surface-hover active:bg-pressed hover:text-ink'
            : 'text-ink-faint'
        "
        :disabled="!canAdd"
        aria-label="把選取的文字加入書籤"
        :title="canAdd ? '把選取的文字加入書籤 (Ctrl+B)' : '先在文件裡選取文字，再按這裡加入書籤'"
        @mousedown.prevent
        @click="emit('add')"
      >
        <AppIcon name="plus" :size="14" />
      </button>
    </template>
  </OutlinePanel>
</template>
