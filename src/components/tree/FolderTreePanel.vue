<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import ContextMenu from "@/components/overlays/ContextMenu.vue";
import FolderTreeNode from "./FolderTreeNode.vue";
import { useDragGesture } from "@/composables/useDragGesture";
import { useSpringValue } from "@/composables/useSpringValue";
import { usePathMenu } from "@/composables/usePathMenu";
import type { MenuTarget } from "@/composables/usePathMenu";
import * as api from "@/services/api";
import { isDesktopRuntime } from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { useExplorerStore } from "@/stores/explorer";
import { useFoldersStore } from "@/stores/folders";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import type { FileEntry } from "@/types/fs";
import { rubberband, SPRINGS } from "@/utils/spring";
import { TREE_MAX_WIDTH, TREE_MIN_WIDTH } from "@/stores/settings";

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
const { menuFor, run: runMenu } = usePathMenu();

const paneId = computed(() => tabs.activePaneId);
const pane = computed(() => explorer.meta(paneId.value));

const menu = ref<{ x: number; y: number; target: MenuTarget } | null>(null);
/** 樹上的節點一定是資料夾，而且只作用於它自己（與清單的選取無關）。 */
const menuItems = computed(() =>
  menu.value ? menuFor({ target: menu.value.target, targets: [menu.value.target] }) : [],
);
const treeScroll = useTemplateRef<HTMLElement>("treeScroll");

let widthAtDragStart = 0;
const widthSpring = useSpringValue(settings.treeWidth, SPRINGS.panel);

// 回彈時由彈簧驅動寬度，維持「放手後仍連續」。
watch(widthSpring.value, (value) => {
  settings.setTreeWidth(value, false);
});

const widthDrag = useDragGesture({
  onStart: () => {
    widthSpring.stop();
    widthAtDragStart = settings.treeWidth;
  },
  onMove: (state) => {
    // 橡皮筋：越過最小／最大寬度時漸進抵抗，而不是硬停。
    const raw = widthAtDragStart + state.dx;
    const next =
      raw < TREE_MIN_WIDTH
        ? TREE_MIN_WIDTH - rubberband(TREE_MIN_WIDTH - raw, TREE_MIN_WIDTH)
        : raw > TREE_MAX_WIDTH
          ? TREE_MAX_WIDTH + rubberband(raw - TREE_MAX_WIDTH, TREE_MAX_WIDTH)
          : raw;
    settings.setTreeWidth(next, false);
  },
  onEnd: (state) => {
    const clamped = Math.min(Math.max(settings.treeWidth, TREE_MIN_WIDTH), TREE_MAX_WIDTH);
    widthSpring.jump(settings.treeWidth);
    widthSpring.set(clamped, state.velocityX);
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
    // 不在清單裡就直接問要不要加進來，比只回一句「找不到」有用。
    const accepted = await ui.confirm({
      title: "加入左側清單？",
      message: `「${target}」不在左側清單的資料夾底下。要把它加入清單嗎？`,
      confirmText: "加入",
    });
    if (!accepted) {
      return;
    }
    if (!folders.addRoot(target)) {
      ui.showNotice("這個資料夾已經在清單裡了");
    }
  }

  folders.setActivePath(target);
  const resolved = folders.rootFor(target);
  if (resolved) {
    await folders.reveal(target, resolved.path);
  }
  await nextTick();

  const node = Array.from(
    treeScroll.value?.querySelectorAll<HTMLElement>("[data-tree-path]") ?? [],
  ).find((element) => element.dataset.treePath === target);
  node?.scrollIntoView({ block: "nearest" });
}

/** 依名稱排序：排完仍然是同一份可拖曳的清單，想微調再自己拉。 */
function sortFolders() {
  if (folders.roots.length < 2) {
    return;
  }
  folders.sortRootsByName();
  ui.showNotice("已依名稱排序");
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
  menu.value = {
    x: event.clientX,
    y: event.clientY,
    target: { path: entry.path, isDir: true },
  };
}

async function onMenuSelect(id: string) {
  const target = menu.value?.target;
  menu.value = null;
  if (target) {
    await runMenu(id, { target, targets: [target] });
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
        class="flex size-7 active:scale-95 shrink-0 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        title="加入資料夾"
        @click="addFolder()"
      >
        <AppIcon name="plus" :size="14" />
      </button>
      <button
        type="button"
        class="flex size-7 active:scale-95 shrink-0 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        title="移除資料夾"
        @click="removeFolder()"
      >
        <AppIcon name="minus" :size="14" />
      </button>
      <span class="flex-1" />
      <button
        type="button"
        class="flex size-7 active:scale-95 shrink-0 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        title="依名稱排序（A→Z）"
        @click="sortFolders()"
      >
        <AppIcon name="sort" :size="14" />
      </button>
      <button
        type="button"
        class="flex size-7 active:scale-95 shrink-0 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        title="定位到清單中選取的資料夾（選到檔案時定位其父目錄）"
        @click="locate()"
      >
        <AppIcon name="locate" :size="14" />
      </button>
      <button
        type="button"
        class="flex size-7 active:scale-95 shrink-0 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        title="收合全部"
        @click="folders.collapseAll()"
      >
        <AppIcon name="chevronUp" :size="14" />
      </button>
      <button
        type="button"
        class="flex size-7 active:scale-95 shrink-0 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        title="收合側欄 (F6)"
        @click="settings.toggleTree()"
      >
        <AppIcon name="chevronLeft" :size="14" />
      </button>
    </div>

    <div ref="treeScroll" class="scroll-area min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
      <FolderTreeNode
        v-for="(root, index) in folders.roots"
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
        :root-index="index"
        @contextmenu="openNodeMenu"
      />

      <div v-if="folders.isEmpty" class="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <div class="flex size-10 items-center justify-center rounded-full bg-surface-muted text-ink-faint">
          <AppIcon name="folderOpen" :size="20" />
        </div>
        <p class="text-base font-medium text-ink">還沒有加入資料夾</p>
        <p class="text-xs leading-relaxed text-ink-muted">
          把工作上常用的資料夾加進來，<br />之後就能一鍵回到這裡。
        </p>
        <button
          type="button"
          class="mt-1 h-7 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink transition-opacity duration-100 hover:opacity-90"
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
      :items="menuItems"
      @select="onMenuSelect"
      @close="menu = null"
    />
  </div>
</template>
