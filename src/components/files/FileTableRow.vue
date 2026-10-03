<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import type { ColumnId, FileEntry } from "@/types/fs";
import { colorFor, iconFor, kindLabel } from "@/utils/fileKind";
import { formatBytes, formatDateTime } from "@/utils/format";

const props = defineProps<{
  entry: FileEntry;
  columns: ColumnId[];
  selected: boolean;
  focused: boolean;
  /** 被剪下、等待貼上的項目：淡化顯示。 */
  cut: boolean;
}>();

defineEmits<{
  activate: [];
  contextmenu: [event: MouseEvent];
}>();

const attributes = computed(() => {
  const values: string[] = [];
  if (props.entry.isReadonly) {
    values.push("唯讀");
  }
  if (props.entry.isHidden) {
    values.push("隱藏");
  }
  if (props.entry.isSymlink) {
    values.push("連結");
  }
  return values.join("・");
});

function cellText(column: ColumnId): string {
  switch (column) {
    case "kind":
      return kindLabel(props.entry);
    case "size":
      return props.entry.isDir ? "—" : formatBytes(props.entry.size);
    case "modified":
      return formatDateTime(props.entry.modifiedMs);
    case "created":
      return formatDateTime(props.entry.createdMs);
    case "attributes":
      return attributes.value;
    case "path":
      return props.entry.path;
    default:
      return "";
  }
}
</script>

<template>
  <div
    data-row
    role="option"
    :aria-selected="selected"
    class="file-grid h-[var(--row-height)] cursor-default pr-3 pl-2.5 text-base pressable"
    :class="[
      cut ? 'opacity-45' : '',
      selected ? 'bg-accent-soft text-ink' : 'hover:bg-surface-hover active:bg-pressed',
      focused ? 'outline outline-1 -outline-offset-1 outline-accent/50' : '',
    ]"
    @dblclick="$emit('activate')"
    @contextmenu.prevent.stop="$emit('contextmenu', $event)"
  >
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
        <span class="truncate" :class="entry.isHidden ? 'text-ink-faint' : ''">{{ entry.name }}</span>
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
        {{ cellText(column) }}
      </div>
    </div>
  </div>
</template>
