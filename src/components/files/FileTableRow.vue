<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import type { ColumnId, FileEntry } from "@/types/fs";
import { cellText } from "@/utils/fileCells";
import { colorFor, iconFor } from "@/utils/fileKind";
import type { CompareState } from "@/utils/compare";

const props = defineProps<{
  entry: FileEntry;
  columns: ColumnId[];
  selected: boolean;
  focused: boolean;
  /** 被剪下、等待貼上的項目：淡化顯示。 */
  cut: boolean;
  /** 這一列正在就地重新命名。 */
  editing: boolean;
  /** 目錄比對的狀態（見 `utils/compare.ts`）；null＝相同或沒開啟比對。 */
  compareState?: CompareState | null;
}>();

const emit = defineEmits<{
  activate: [];
  contextmenu: [event: MouseEvent];
  /** 就地編輯確認（Enter 或失去焦點）。 */
  rename: [value: string];
  /** 就地編輯取消（Esc）。 */
  renameCancel: [];
}>();

const draft = ref("");
const input = ref<HTMLInputElement | null>(null);

/** 目錄比對的底色；選取時讓給選取色，色條則一律留著。 */
const compareRowClass = computed(() =>
  props.compareState === "only"
    ? "bg-compare-only-soft"
    : props.compareState === "different"
      ? "bg-compare-different-soft"
      : "",
);

const compareStripeClass = computed(() =>
  props.compareState === "only"
    ? "bg-compare-only"
    : props.compareState === "different"
      ? "bg-compare-different"
      : "",
);

const compareTitle = computed(() => {
  switch (props.compareState) {
    case "only":
      return "另一邊沒有這個項目";
    case "different":
      return "兩邊都有，但大小或修改時間不同";
    default:
      return null;
  }
});

/**
 * 輸入框的 template ref。
 *
 * 輸入框在欄位迴圈（`v-for`）裡面，而字串 ref 只要落在 `v-for` 的範圍內，Vue 就會
 * 把它收成陣列（`input.value` 變成 `[<input>]`），`focus()` 就再也不是函式 ——
 * F2 之後游標根本沒進輸入框。函式 ref 拿到的才是元素本身。
 */
function setInput(element: Element | ComponentPublicInstance | null) {
  input.value = element instanceof HTMLInputElement ? element : null;
}

/**
 * 這一輪編輯是否已經結束。
 *
 * Enter／Esc 之後輸入框會跟著被移除，緊接著的 blur 不該再送一次（會變成
 * 「Esc 取消卻又改名」或「送出兩次」）。
 */
let finished = false;

/** 主檔名長度：檔案只選取到最後一個句點之前，資料夾全選（與建立新檔案一致）。 */
function stemLength(name: string, isDir: boolean): number {
  if (isDir) {
    return name.length;
  }
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

watch(
  () => props.editing,
  async (editing) => {
    if (!editing) {
      return;
    }
    finished = false;
    draft.value = props.entry.name;
    await nextTick();
    const element = input.value;
    if (!element) {
      return;
    }
    element.focus();
    element.setSelectionRange(0, stemLength(props.entry.name, props.entry.isDir));
  },
  { immediate: true },
);

function commit() {
  if (finished) {
    return;
  }
  finished = true;
  emit("rename", draft.value);
}

function cancel() {
  if (finished) {
    return;
  }
  finished = true;
  emit("renameCancel");
}

/** 雙擊開啟只在不編輯時生效（編輯時雙擊是在輸入框裡選字）。 */
function onDblclick() {
  if (!props.editing) {
    emit("activate");
  }
}

// 這一列在編輯中被抽換掉（捲出可視範圍、清單重讀）時，不要拿還停在半路的內容去改名。
onBeforeUnmount(() => {
  finished = true;
});
</script>

<template>
  <div
    data-row
    role="option"
    :aria-selected="selected"
    class="file-grid relative h-[var(--row-height)] cursor-default pr-3 pl-2.5 text-base pressable"
    :class="[
      cut ? 'opacity-45' : '',
      selected
        ? 'bg-accent-soft text-ink'
        : [compareRowClass, 'hover:bg-surface-hover active:bg-pressed'],
      focused ? 'outline outline-1 -outline-offset-1 outline-accent/50' : '',
    ]"
    :title="compareTitle ?? undefined"
    @dblclick="onDblclick"
    @contextmenu.prevent.stop="$emit('contextmenu', $event)"
  >
    <!--
      目錄比對的左緣色條：絕對定位蓋在左邊留白上，開關比對時整列不會左右跳動；
      選取時底色讓給 accent-soft，色條仍然看得見。
    -->
    <span
      v-if="compareStripeClass"
      class="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
      :class="compareStripeClass"
    />
    <!--
      格子要撐滿整列高度（h-full），否則 border-r 只會畫在文字那一小段，
      分隔線就會上下斷開。內容各自再用 flex 置中。
    -->
    <div
      v-for="(column, index) in columns"
      :key="column"
      class="flex h-full min-w-0 items-center px-1"
      :class="[
        column === 'size' ? 'justify-end' : '',
        index < columns.length - 1 ? 'border-r border-line' : '',
      ]"
    >
      <div v-if="column === 'name'" class="flex min-w-0 flex-1 items-center gap-2">
        <AppIcon :name="iconFor(entry)" :size="15" class="file-icon" :class="colorFor(entry)" />
        <input
          v-if="editing"
          :ref="setInput"
          v-model="draft"
          type="text"
          spellcheck="false"
          class="min-w-0 flex-1 rounded-sm border border-accent bg-surface px-1 text-base text-ink focus:outline-none"
          @pointerdown.stop
          @click.stop
          @dblclick.stop
          @keydown.enter.prevent="commit"
          @keydown.esc.prevent="cancel"
          @blur="commit"
        />
        <span v-else class="truncate" :class="entry.isHidden ? 'text-ink-faint' : ''">{{ entry.name }}</span>
        <span
          v-if="entry.isSymlink"
          class="shrink-0 rounded bg-surface-muted px-1 text-2xs text-ink-faint"
          title="符號連結"
        >
          連結
        </span>
      </div>
      <div
        v-else
        class="min-w-0 truncate tabular-nums"
        :class="column === 'path' ? 'text-ink-faint' : 'text-ink-muted'"
      >
        {{ cellText(column, entry) }}
      </div>
    </div>
  </div>
</template>
