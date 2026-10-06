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
import { useFoldersStore, TREE_ROOT_CONTAINER } from "@/stores/folders";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import type { FolderNode } from "@/types/fs";
import type { MenuItem } from "@/types/menu";
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

/**
 * 樹工具列「別名」的對象：先看清單中選取的節點，沒有選取時用焦點窗格路徑回推。
 * 只有第一層的真實資料夾（含虛擬目錄下的第一層）合格，其餘一律停用。
 */
const aliasCandidate = computed(
  () => folders.selectedNode() ?? folders.folderNodeFor(pane.value?.currentPath ?? ""),
);
const aliasTarget = computed(() =>
  folders.isAliasTarget(aliasCandidate.value) ? aliasCandidate.value : null,
);

/** 三種選單（加入、節點、移動到虛擬目錄）共用同一個實例，各自帶自己的處理函式。 */
interface TreeMenu {
  x: number;
  y: number;
  items: MenuItem[];
  onSelect: (id: string) => void;
}

const menu = ref<TreeMenu | null>(null);
const treeScroll = useTemplateRef<HTMLElement>("treeScroll");
const addButton = useTemplateRef<HTMLButtonElement>("addButton");

function openMenu(x: number, y: number, items: MenuItem[], onSelect: (id: string) => void) {
  menu.value = { x, y, items, onSelect };
}

function onMenuSelect(id: string) {
  const current = menu.value;
  menu.value = null;
  current?.onSelect(id);
}

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
    folders.selectByPath(path);
    void folders.reveal(path);
  },
  { immediate: true },
);

/* ---------------------------------------------------------------------------
 * 加入資料夾／虛擬目錄
 * ------------------------------------------------------------------------- */

/** 樹工具列的＋：先問要建立虛擬目錄，還是直接加入真實資料夾。 */
function openAddMenu() {
  const rect = addButton.value?.getBoundingClientRect();
  openMenu(
    rect?.left ?? 8,
    rect ? rect.bottom + 4 : 44,
    [
      { id: "add-group", label: "新增虛擬目錄", icon: "folderStack" },
      { id: "add-folder", label: "加入真實資料夾", icon: "folder" },
    ],
    (id) => {
      if (id === "add-group") {
        void createGroup();
        return;
      }
      void addFolder(TREE_ROOT_CONTAINER);
    },
  );
}

async function createGroup() {
  const label = await ui.prompt({
    title: "新增虛擬目錄",
    label: "名稱",
    value: "新增虛擬目錄",
    confirmText: "建立",
  });
  if (label) {
    folders.addGroup(label);
  }
}

/** 加入真實資料夾；`groupId` 省略時放到第一層。 */
async function addFolder(groupId: string) {
  try {
    const chosen = await api.chooseFolder(pane.value?.currentPath);
    if (!chosen) {
      if (!isDesktopRuntime()) {
        ui.showNotice("瀏覽器預覽模式沒有原生資料夾選擇器");
      }
      return;
    }
    if (!folders.addFolder(chosen, groupId)) {
      ui.showNotice("這個資料夾已經在清單裡了");
      return;
    }
    await explorer.navigate(paneId.value, chosen);
  } catch (cause) {
    ui.showNotice(normalizeBackendError(cause).message);
  }
}

/* ---------------------------------------------------------------------------
 * 定位／排序／移除
 * ------------------------------------------------------------------------- */

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

  if (!folders.folderNodeFor(target)) {
    // 不在清單裡就直接問要不要加進來，比只回一句「找不到」有用。
    const accepted = await ui.confirm({
      title: "加入左側清單？",
      message: `「${target}」不在左側清單的資料夾底下。要把它加入清單嗎？`,
      confirmText: "加入",
    });
    if (!accepted) {
      return;
    }
    if (!folders.addFolder(target)) {
      ui.showNotice("這個資料夾已經在清單裡了");
    }
  }

  folders.selectByPath(target);
  await folders.reveal(target);
  await nextTick();

  const node = Array.from(
    treeScroll.value?.querySelectorAll<HTMLElement>("[data-tree-path]") ?? [],
  ).find((element) => element.dataset.treePath === target);
  node?.scrollIntoView({ block: "nearest" });
}

/** 排序的範圍就是「選取節點所在的那一層」；沒有選取時退回到窗格路徑所在的那一層。 */
function sortContainerId(): string {
  const node = folders.selectedNode() ?? folders.folderNodeFor(pane.value?.currentPath ?? "");
  return node ? (folders.containerIdOf(node.id) ?? TREE_ROOT_CONTAINER) : TREE_ROOT_CONTAINER;
}

function sortItems() {
  const containerId = sortContainerId();
  if (folders.nodesIn(containerId).length < 2) {
    return;
  }
  folders.sortNodes(containerId);
  const group = containerId ? folders.nodeById(containerId) : null;
  ui.showNotice(`已依名稱排序：${group ? group.label : "第一層"}`);
}

/** 設定／修改／清除別名；留空即清除。 */
async function editAlias() {
  const node = aliasTarget.value;
  if (!node) {
    return;
  }
  const input = await ui.prompt({
    title: "設定別名",
    label: `「${node.label}」的別名（留空可清除）`,
    placeholder: "例如：工作",
    value: node.alias ?? "",
    confirmText: "套用",
    allowEmpty: true,
  });
  if (input === null || !folders.setAlias(node.id, input)) {
    return;
  }
  const alias = input.trim();
  ui.showNotice(alias ? `已將「${node.label}」的別名設為「${alias}」` : `已清除「${node.label}」的別名`);
}

/** 移除的對象：目前選取的節點，其次是焦點窗格路徑所屬的資料夾。 */
function removableNode(): FolderNode | null {
  return folders.selectedNode() ?? folders.folderNodeFor(pane.value?.currentPath ?? "");
}

function removeNodeWithUndo(node: FolderNode) {
  const removed = folders.removeNode(node.id);
  if (!removed) {
    return;
  }
  const what = node.kind === "group" ? `虛擬目錄「${node.label}」` : `「${node.label}」`;
  ui.showNotice(`已移除${what}`, { label: "復原", run: () => folders.insertNode(removed) }, 5000);
}

async function removeGroup(node: FolderNode) {
  const count = node.children?.length ?? 0;
  const inside = count ? `與裡面的 ${count} 個資料夾` : "";
  const accepted = await ui.confirm({
    title: "移除虛擬目錄？",
    message: `「${node.label}」${inside}會從清單移除，不會刪除實體檔案。`,
    confirmText: "移除",
  });
  if (accepted) {
    removeNodeWithUndo(node);
  }
}

function removeSelected() {
  const node = removableNode();
  if (!node) {
    ui.showNotice("請先在清單中選擇要移除的項目");
    return;
  }
  if (node.kind === "group") {
    void removeGroup(node);
    return;
  }
  removeNodeWithUndo(node);
}

/* ---------------------------------------------------------------------------
 * 節點右鍵選單
 * ------------------------------------------------------------------------- */

function openNodeMenu(node: FolderNode, event: MouseEvent) {
  folders.select(node.id);

  if (node.kind === "group") {
    openMenu(
      event.clientX,
      event.clientY,
      [
        { id: "group:rename", label: "重新命名", icon: "pencil" },
        { id: "group:add", label: "加入資料夾到此群組", icon: "plus" },
        { id: "group:remove", label: "移除虛擬目錄", icon: "minus", separatorBefore: true },
      ],
      (id) => void runGroupAction(id, node),
    );
    return;
  }

  // 真實資料夾：沿用檔案清單那套路徑選單，最後再加一個「搬到虛擬目錄」。
  // 左側是書籤清單，不直接操作實體檔案，所以不顯示剪貼組（剪下／複製／貼上／刪除），
  // 樹也沒有就地編輯，因此不提供重新命名。
  const target: MenuTarget = { path: node.path ?? "", isDir: true };
  const items: MenuItem[] = menuFor({ paneId: paneId.value, target, targets: [target] });
  items.push({
    id: "node:move",
    label: "移動到虛擬目錄…",
    icon: "folderStack",
    separatorBefore: true,
    disabled: folders.groupNodes().length === 0,
  });
  openMenu(event.clientX, event.clientY, items, (id) => void runNodeAction(id, node, target, event));
}

async function runGroupAction(id: string, node: FolderNode) {
  if (id === "group:rename") {
    const label = await ui.prompt({
      title: "重新命名虛擬目錄",
      label: "名稱",
      value: node.label,
      confirmText: "重新命名",
    });
    if (label) {
      folders.renameNode(node.id, label);
    }
    return;
  }
  if (id === "group:add") {
    await addFolder(node.id);
    return;
  }
  if (id === "group:remove") {
    await removeGroup(node);
  }
}

async function runNodeAction(
  id: string,
  node: FolderNode,
  target: MenuTarget,
  event: MouseEvent,
) {
  if (id !== "node:move") {
    await runMenu(id, { paneId: paneId.value, target, targets: [target] });
    return;
  }
  // 兩段式選單：沿用剛剛那個位置，接著列出所有虛擬目錄。
  const original = folders.containerIdOf(node.id);
  openMenu(
    event.clientX,
    event.clientY,
    folders.groupNodes().map((group) => ({
      id: `node:move-to:${group.id}`,
      label: group.label,
      icon: "folderStack",
      disabled: group.id === original,
    })),
    (picked) => {
      const groupId = picked.slice("node:move-to:".length);
      const group = folders.nodeById(groupId);
      if (group && folders.moveNodeToGroup(node.id, groupId)) {
        ui.showNotice(`已將「${node.label}」移到「${group.label}」`);
      }
    },
  );
}
</script>

<template>
  <div
    class="relative flex min-h-0 shrink-0 flex-col border-r border-line bg-rail"
    :style="{ width: `${settings.treeWidth}px` }"
  >
    <div class="flex h-9 shrink-0 items-center gap-0.5 border-b border-line px-1.5">
      <button
        ref="addButton"
        type="button"
        class="flex size-7 active:scale-95 shrink-0 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        title="加入資料夾或新增虛擬目錄"
        @click="openAddMenu()"
      >
        <AppIcon name="plus" :size="14" />
      </button>
      <button
        type="button"
        class="flex size-7 active:scale-95 shrink-0 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        title="移除選取的資料夾或虛擬目錄"
        @click="removeSelected()"
      >
        <AppIcon name="minus" :size="14" />
      </button>
      <button
        type="button"
        class="flex size-7 active:scale-95 shrink-0 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-muted"
        :disabled="!aliasTarget"
        title="設定別名（第一層的真實資料夾）"
        @click="editAlias()"
      >
        <AppIcon name="tag" :size="14" />
      </button>
      <span class="flex-1" />
      <button
        type="button"
        class="flex size-7 active:scale-95 shrink-0 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        title="依名稱排序（排選取項目所在的那一層）"
        @click="sortItems()"
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
        v-for="(node, index) in folders.roots"
        :key="node.id"
        :node="node"
        :depth="0"
        :pane-id="paneId"
        :container-id="TREE_ROOT_CONTAINER"
        :item-index="index"
        @contextmenu="openNodeMenu"
      />

      <div v-if="folders.isEmpty" class="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <div class="flex size-10 items-center justify-center rounded-full bg-surface-muted text-ink-faint">
          <AppIcon name="folderOpen" :size="20" />
        </div>
        <p class="text-base font-medium text-ink">還沒有加入資料夾</p>
        <p class="text-xs leading-relaxed text-ink-muted">
          把工作上常用的資料夾加進來，<br />之後就能一鍵回到這裡，也可以建立虛擬目錄分組。
        </p>
        <button
          type="button"
          class="mt-1 h-7 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink transition-opacity duration-100 hover:opacity-90"
          @click="openAddMenu()"
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
      :items="menu.items"
      @select="onMenuSelect"
      @close="menu = null"
    />
  </div>
</template>
