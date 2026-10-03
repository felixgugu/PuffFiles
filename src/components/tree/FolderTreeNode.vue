<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useExplorerStore } from "@/stores/explorer";
import { useFoldersStore } from "@/stores/folders";
import type { FileEntry, PaneId } from "@/types/fs";
import { samePath } from "@/utils/path";

const props = defineProps<{
  entry: FileEntry;
  depth: number;
  paneId: PaneId;
}>();

const emit = defineEmits<{
  contextmenu: [entry: FileEntry, event: MouseEvent];
}>();

const folders = useFoldersStore();
const explorer = useExplorerStore();

const expanded = computed(() => folders.isExpanded(props.entry.path));
const children = computed(() => folders.childrenOf(props.entry.path));
const loading = computed(() => folders.isLoading(props.entry.path));
const isCurrent = computed(() =>
  samePath(explorer.meta(props.paneId)?.currentPath ?? "", props.entry.path),
);
const isSelected = computed(() => samePath(folders.activePath, props.entry.path));

function open() {
  folders.setActivePath(props.entry.path);
  void explorer.navigate(props.paneId, props.entry.path);
}

function toggle() {
  void folders.toggle(props.entry.path);
}

function forwardContextMenu(entry: FileEntry, event: MouseEvent) {
  emit("contextmenu", entry, event);
}
</script>

<template>
  <div>
    <div
      :data-tree-path="entry.path"
      class="group flex h-7 items-center rounded-md pr-1.5 text-[13px] transition-colors duration-75"
      :class="[
        isCurrent
          ? 'bg-accent-soft text-ink'
          : isSelected
            ? 'bg-surface-hover text-ink'
            : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
      ]"
      :style="{ paddingLeft: `${6 + depth * 12}px` }"
      @click="open"
      @contextmenu.prevent="emit('contextmenu', entry, $event)"
    >
      <button
        type="button"
        class="flex size-5 shrink-0 items-center justify-center rounded text-ink-faint transition-colors duration-75 hover:text-ink"
        :title="expanded ? '收合' : '展開'"
        @click.stop="toggle"
      >
        <AppIcon
          name="chevronRight"
          :size="12"
          class="transition-transform duration-150 ease-out"
          :class="expanded ? 'rotate-90' : ''"
        />
      </button>
      <AppIcon
        :name="expanded ? 'folderOpen' : 'folder'"
        :size="14"
        class="mr-1.5 shrink-0 text-accent/85"
      />
      <span class="min-w-0 flex-1 truncate" :title="entry.name">{{ entry.name }}</span>
    </div>

    <!-- 展開：子節點只在真的展開時才建立，收合的節點完全不佔成本。 -->
    <div v-if="expanded">
      <p v-if="loading && !children.length" class="py-1 text-[11px] text-ink-faint" :style="{ paddingLeft: `${18 + depth * 12}px` }">
        讀取中…
      </p>
      <FolderTreeNode
        v-for="child in children"
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
        :pane-id="paneId"
        @contextmenu="forwardContextMenu"
      />
      <p
        v-if="!loading && !children.length"
        class="py-1 text-[11px] text-ink-faint"
        :style="{ paddingLeft: `${18 + depth * 12}px` }"
      >
        沒有子資料夾
      </p>
    </div>
  </div>
</template>
