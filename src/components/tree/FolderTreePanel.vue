<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import ContextMenu from "@/components/overlays/ContextMenu.vue";
import FolderTreeNode from "./FolderTreeNode.vue";
import { useDragGesture } from "@/composables/useDragGesture";
import { usePathMenu } from "@/composables/usePathMenu";
import * as api from "@/services/api";
import { isDesktopRuntime } from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { useExplorerStore } from "@/stores/explorer";
import { useFoldersStore } from "@/stores/folders";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import type { FileEntry } from "@/types/fs";

/**
 * 整個分頁共用一份資料夾樹。
 *
 * 它永遠代表「目前焦點窗格」：使用者點另一邊，這棵樹與上方的路徑列
 * 會一起切換過去 —— 一份樹、一條路徑列，兩個窗格共用。
 */
const explorer = useExplorerStore();
const folders = useFoldersStore();
const settings = useSettingsStore();
const tabs = useTabsStore();
const ui = useUiStore();
const pathMenu = usePathMenu();

const paneId = computed(() => tabs.activePaneId);
const pane = computed(() => explorer.meta(paneId.value));

const menu = ref<{ x: number; y: number; path: string } | null>(null);
const treeScroll = useTemplateRef<HTMLElement>("treeScroll");

let widthAtDragStart = 0;

const widthDrag = useDragGesture({
  onStart: () => {
    widthAtDragStart = settings.treeWidth;
  },
  onMove: (state) => {
    settings.setTreeWidth(widthAtDragStart + state.dx);
  },
  onEnd: () => {
    /* 1:1 跟手，放開後維持使用者選定的寬度。 */
  },
});

// 焦點窗格或它的路徑改變時，樹跟著展開並高亮到對應位置。
watch(
  () => [paneId.value, pane.value?.currentPath] as const,
  ([, path]) => {
    if (!path) {
      return;
    }
    folders.setActivePath(path);
    const root = folders.rootFor(path);
    if (root) {
      void folders.reveal(path, root.path);
    }
  },
  { immediate: true },
);

async function addFolder() {
  try {
    const chosen = await api.chooseFolder(pane.value?.currentPath);
    if (!chosen) {
      if (!isDesktopRuntime()) {
        ui.showNotice("瀏覽器預覽模式沒有原生資料夾選擇器");
      }
      return;
    }
    if (!folders.addRoot(chosen)) {
      ui.showNotice("這個資料夾已經在清單裡了");
      return;
    }
    await explorer.navigate(paneId.value, chosen);
  } catch (cause) {
    ui.showNotice(normalizeBackendError(cause).message);
  }
}

/** 移除的對象：目前選取的節點所屬的根，其次是焦點窗格路徑所屬的根。 */
function removableRoot() {
  return folders.activeRoot() ?? folders.rootFor(pane.value?.currentPath ?? "");
}

/**
 * 定位：把樹移到清單裡「已選取」的那個位置。
 *
 * 選到資料夾就定位它本身，選到檔案則定位它的父目錄；
 * 沒有選取任何項目時，定位到窗格目前所在的資料夾。
 */
async function locate() {
  const target = explorer.locateDirectory(paneId.value);
  if (!target) {
    return;
  }

  const root = folders.rootFor(target);
  if (!root) {
    ui.showNotice("這個位置不在左側清單的資料夾底下");
    return;
  }

  folders.setActivePath(target);
  await folders.reveal(target, root.path);
  await nextTick();

  const node = Array.from(
    treeScroll.value?.querySelectorAll<HTMLElement>("[data-tree-path]") ?? [],
  ).find((element) => element.dataset.treePath === target);
  node?.scrollIntoView({ block: "nearest" });
}

function removeFolder() {
  const root = removableRoot();
  if (!root) {
    ui.showNotice("請先在清單中選擇要移除的資料夾");
    return;
  }
  const index = folders.rootIndexOf(root.id);
  const removed = folders.removeRoot(root.id);
  if (!removed) {
    return;
  }
  ui.showNotice(
    `已移除「${removed.label}」`,
    { label: "復原", run: () => folders.insertRoot(removed, index) },
    5000,
  );
}

function openNodeMenu(entry: FileEntry, event: MouseEvent) {
  folders.setActivePath(entry.path);
  menu.value = { x: event.clientX, y: event.clientY, path: entry.path };
}

async function onMenuSelect(id: string) {
  const target = menu.value?.path;
  menu.value = null;
  if (target) {
    await pathMenu.run(id, target);
  }
}
</script>

<template>
  <div
    class="relative flex min-h-0 shrink-0 flex-col border-r border-line bg-rail"
    :style="{ width: `${settings.treeWidth}px` }"
  >
    <div class="flex h-9 shrink-0 items-center gap-0.5 border-b border-line px-1.5">
      <button
        type="button"
        class="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-75 hover:bg-surface-hover hover:text-ink"
        title="加入資料夾"
        @click="addFolder()"
      >
        <AppIcon name="plus" :size="14" />
      </button>
      <button
        type="button"
        class="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-75 hover:bg-surface-hover hover:text-ink"
        title="移除資料夾"
        @click="removeFolder()"
      >
        <AppIcon name="minus" :size="14" />
      </button>
      <span class="flex-1" />
      <button
        type="button"
        class="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-75 hover:bg-surface-hover hover:text-ink"
        title="定位到清單中選取的資料夾（選到檔案時定位其父目錄）"
        @click="locate()"
      >
        <AppIcon name="locate" :size="14" />
      </button>
      <button
        type="button"
        class="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-75 hover:bg-surface-hover hover:text-ink"
        title="收合全部"
        @click="folders.collapseAll()"
      >
        <AppIcon name="chevronUp" :size="14" />
      </button>
      <button
        type="button"
        class="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-75 hover:bg-surface-hover hover:text-ink"
        title="收合側欄 (F6)"
        @click="settings.toggleTree()"
      >
        <AppIcon name="chevronLeft" :size="14" />
      </button>
    </div>

    <div ref="treeScroll" class="scroll-area min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
      <FolderTreeNode
        v-for="root in folders.roots"
        :key="root.id"
        :entry="{
          name: root.label,
          path: root.path,
          isDir: true,
          isSymlink: false,
          isHidden: false,
          isReadonly: false,
          size: 0,
          modifiedMs: null,
          createdMs: null,
          extension: null,
        }"
        :depth="0"
        :pane-id="paneId"
        @contextmenu="openNodeMenu"
      />

      <div v-if="folders.isEmpty" class="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <div class="flex size-10 items-center justify-center rounded-full bg-surface-muted text-ink-faint">
          <AppIcon name="folderOpen" :size="20" />
        </div>
        <p class="text-[13px] font-medium text-ink">還沒有加入資料夾</p>
        <p class="text-[11px] leading-relaxed text-ink-muted">
          把工作上常用的資料夾加進來，<br />之後就能一鍵回到這裡。
        </p>
        <button
          type="button"
          class="mt-1 h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-accent-ink transition-opacity duration-100 hover:opacity-90"
          @click="addFolder()"
        >
          加入資料夾
        </button>
      </div>
    </div>

    <!-- 拖曳調整寬度：1:1 跟手，尊重抓取位移。 -->
    <div
      class="absolute top-0 -right-1 z-20 h-full w-2 cursor-col-resize"
      :class="widthDrag.dragging.value ? 'bg-accent/40' : 'hover:bg-accent/20'"
      @pointerdown="widthDrag.onPointerDown"
    />

    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="pathMenu.folderMenu"
      @select="onMenuSelect"
      @close="menu = null"
    />
  </div>
</template>
