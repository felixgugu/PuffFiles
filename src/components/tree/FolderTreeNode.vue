<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useSpringValue } from "@/composables/useSpringValue";
import { useExplorerStore } from "@/stores/explorer";
import { useFoldersStore } from "@/stores/folders";
import type { FileEntry, PaneId } from "@/types/fs";
import { SPRINGS } from "@/utils/spring";
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

// 展開／收合用彈簧驅動而不是 CSS 過渡：動畫途中再點一次會直接反轉，
// 不會先跑完再重來。
const { value: progress, set: setProgress } = useSpringValue(expanded.value ? 1 : 0, SPRINGS.tree);
watch(expanded, (open) => setProgress(open ? 1 : 0));

// 收合時子節點要留到動畫結束才移除，否則沒有東西可以縮。
const mounted = ref(expanded.value);
watch(
  progress,
  (value) => {
    if (value > 0.005) {
      mounted.value = true;
    } else if (!expanded.value) {
      mounted.value = false;
    }
  },
);

const childrenStyle = computed(() => ({
  gridTemplateRows: `${progress.value}fr`,
  opacity: String(Math.min(1, progress.value * 1.4)),
}));

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
      class="group flex h-7 items-center rounded-md pr-1.5 text-base pressable"
      :class="[
        isCurrent
          ? 'bg-accent-soft text-ink'
          : isSelected
            ? 'bg-surface-hover text-ink'
            : 'text-ink-muted hover:bg-surface-hover active:bg-pressed hover:text-ink',
      ]"
      :style="{ paddingLeft: `${6 + depth * 12}px` }"
      @click="open"
      @contextmenu.prevent="emit('contextmenu', entry, $event)"
    >
      <button
        type="button"
        class="flex size-5 active:scale-95 shrink-0 items-center justify-center rounded text-ink-faint pressable hover:text-ink"
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

    <!--
      展開：`grid-template-rows` 由彈簧驅動（0fr → 1fr），所以收合時子節點要留到
      動畫結束才移除；完全收合的節點仍然不佔成本。
    -->
    <div v-if="mounted" class="grid" :style="childrenStyle">
      <div class="min-h-0 overflow-hidden">
        <p
          v-if="loading && !children.length"
          class="py-1 text-xs text-ink-faint"
          :style="{ paddingLeft: `${18 + depth * 12}px` }"
        >
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
          class="py-1 text-xs text-ink-faint"
          :style="{ paddingLeft: `${18 + depth * 12}px` }"
        >
          沒有子資料夾
        </p>
      </div>
    </div>
  </div>
</template>
