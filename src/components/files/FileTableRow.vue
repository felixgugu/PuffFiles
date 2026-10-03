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
}>();

defineEmits<{
  select: [event: MouseEvent];
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
    class="file-grid h-[30px] cursor-default pr-3 pl-2.5 text-[13px] transition-colors duration-75"
    :class="[
      selected ? 'bg-accent-soft text-ink' : 'hover:bg-surface-hover',
      focused ? 'outline outline-1 -outline-offset-1 outline-accent/50' : '',
    ]"
    @click="$emit('select', $event)"
    @dblclick="$emit('activate')"
    @contextmenu.prevent.stop="$emit('contextmenu', $event)"
  >
    <div v-for="column in columns" :key="column" class="min-w-0 px-1" :class="column === 'size' ? 'text-right' : ''">
      <div v-if="column === 'name'" class="flex min-w-0 items-center gap-2">
        <AppIcon :name="iconFor(entry)" :size="15" :class="colorFor(entry)" />
        <span class="truncate" :class="entry.isHidden ? 'text-ink-faint' : ''">{{ entry.name }}</span>
        <span
          v-if="entry.isSymlink"
          class="shrink-0 rounded bg-surface-muted px-1 text-[10px] text-ink-faint"
          title="符號連結"
        >
          連結
        </span>
      </div>
      <div v-else class="truncate tabular-nums" :class="column === 'path' ? 'text-ink-faint' : 'text-ink-muted'">
        {{ cellText(column) }}
      </div>
    </div>
  </div>
</template>
