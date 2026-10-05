<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useSpringValue } from "@/composables/useSpringValue";
import { useExplorerStore } from "@/stores/explorer";
import { useFoldersStore } from "@/stores/folders";
import { useSettingsStore } from "@/stores/settings";
import type { FolderNode, PaneId } from "@/types/fs";
import { folderDisplayName } from "@/utils/folders";
import { SPRINGS } from "@/utils/spring";
import { samePath } from "@/utils/path";

const props = defineProps<{
  node: FolderNode;
  depth: number;
  paneId: PaneId;
  /**
   * 節點所屬的容器（空字串＝第一層，其餘是虛擬目錄 id）與它在容器中的位置。
   * 只有清單上的節點會拿到；檔案系統的子資料夾不帶，因此不能拖曳排序。
   */
  containerId?: string;
  itemIndex?: number;
}>();

const emit = defineEmits<{
  contextmenu: [node: FolderNode, event: MouseEvent];
}>();

const folders = useFoldersStore();
const explorer = useExplorerStore();
const settings = useSettingsStore();

const isGroup = computed(() => props.node.kind === "group");
/** 有別名時套用設定裡的顯示格式；沒有別名的節點（含檔案系統子資料夾）就是原名。 */
const displayName = computed(() => folderDisplayName(props.node, settings.aliasTemplate));
const draggable = computed(() => props.containerId !== undefined && props.itemIndex !== undefined);
const expanded = computed(() => folders.isExpanded(props.node));
const isActive = computed(() => folders.activeId === props.node.id);
const isCurrent = computed(
  () =>
    !isGroup.value && samePath(explorer.meta(props.paneId)?.currentPath ?? "", props.node.path ?? ""),
);

/** 虛擬目錄的內容就是清單裡的真實資料夾；真實資料夾的內容則來自檔案系統。 */
const groupChildren = computed(() => (isGroup.value ? (props.node.children ?? []) : []));
const folderChildren = computed(() =>
  isGroup.value || !props.node.path ? [] : folders.childrenOf(props.node.path),
);
const loading = computed(() =>
  isGroup.value || !props.node.path ? false : folders.isLoading(props.node.path),
);

/* ---------------------------------------------------------------------------
 * 拖曳排序：只在同一個容器內搬動（跨容器一律不搬，搬進虛擬目錄走右鍵選單）。
 *
 * 與分頁列同一套做法 —— 指標一進入鄰居的範圍就立刻搬動，結果連續可見，
 * 不需要另外畫一條插入線。
 * ------------------------------------------------------------------------- */

interface DragSession {
  containerId: string;
  index: number;
  startY: number;
  moved: boolean;
  element: HTMLElement;
  pointerId: number;
}

let drag: DragSession | null = null;
const dragging = ref(false);
/** 拖曳結束後緊接著的那一次 click 要吞掉，否則放開手會順便跳進那個資料夾。 */
let swallowClick = false;

/** 捕捉指標；指標在拖曳途中消失（或事件是合成出來的）時不該讓整個手勢爆掉。 */
function setCapture(element: HTMLElement, pointerId: number, on: boolean) {
  try {
    if (on) {
      element.setPointerCapture(pointerId);
    } else {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // 捕捉失敗只影響「指標移出元素後還收不收得到事件」，拖曳本身照常結束。
  }
}

function detach() {
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
  window.removeEventListener("pointercancel", onWindowPointerUp);
}

function onPointerDown(event: PointerEvent) {
  swallowClick = false;
  if (!draggable.value || event.button !== 0 || props.containerId === undefined) {
    return;
  }
  // 展開／收合鈕是獨立操作：絕對不要在這裡捕捉指標，否則這一列的 click 會蓋掉它。
  if (event.target instanceof Element && event.target.closest("[data-tree-toggle]")) {
    return;
  }
  drag = {
    containerId: props.containerId,
    index: props.itemIndex ?? 0,
    startY: event.clientY,
    moved: false,
    element: event.currentTarget as HTMLElement,
    pointerId: event.pointerId,
  };
  // 用 window 監聽而不是「按下就捕捉指標」：捕捉會把 click 重導到整列，
  // 一般點擊（導覽）與展開鈕都會被影響。等真的開始拖曳再捕捉。
  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
  window.addEventListener("pointercancel", onWindowPointerUp);
}

function onWindowPointerMove(event: PointerEvent) {
  const session = drag;
  if (!session || event.pointerId !== session.pointerId) {
    return;
  }
  if (!session.moved && Math.abs(event.clientY - session.startY) < 4) {
    return;
  }
  if (!session.moved) {
    session.moved = true;
    dragging.value = true;
    setCapture(session.element, session.pointerId, true);
  }

  // 只看同一個容器的列：拖到別的虛擬目錄或第一層都不會有反應。
  let target = session.index;
  document.querySelectorAll<HTMLElement>("[data-item-index]").forEach((row) => {
    if ((row.dataset.containerId ?? "") !== session.containerId) {
      return;
    }
    const rect = row.getBoundingClientRect();
    if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
      target = Number(row.dataset.itemIndex);
    }
  });

  if (target !== session.index) {
    folders.moveNode(session.containerId, session.index, target);
    session.index = target;
    session.startY = event.clientY;
  }
}

function onWindowPointerUp(event: PointerEvent) {
  const session = drag;
  if (!session || event.pointerId !== session.pointerId) {
    return;
  }
  drag = null;
  dragging.value = false;
  detach();
  swallowClick = session.moved;
  setCapture(session.element, session.pointerId, false);
}

// 元件在拖曳途中被卸載時，window 上的監聽不能留下來。
onScopeDispose(detach);

/* ---------------------------------------------------------------------------
 * 展開／收合
 * ------------------------------------------------------------------------- */

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

function activate() {
  // 剛拖曳完的那一下放開不算「點擊」。
  if (swallowClick) {
    swallowClick = false;
    return;
  }
  folders.select(props.node.id);
  // 虛擬目錄沒有實體位置，點它＝展開／收合。
  if (isGroup.value) {
    void folders.toggle(props.node);
    return;
  }
  if (props.node.path) {
    void explorer.navigate(props.paneId, props.node.path);
  }
}

function toggle() {
  void folders.toggle(props.node);
}

function forwardContextMenu(node: FolderNode, event: MouseEvent) {
  emit("contextmenu", node, event);
}
</script>

<template>
  <div>
    <div
      :data-tree-path="node.path"
      :data-container-id="draggable ? containerId : undefined"
      :data-item-index="draggable ? itemIndex : undefined"
      class="group flex h-7 items-center rounded-md pr-1.5 text-base pressable"
      :class="[
        draggable ? 'cursor-grab' : '',
        dragging ? 'z-10 opacity-95 shadow-md' : '',
        isCurrent
          ? 'bg-accent-soft text-tree-ink-strong'
          : isActive
            ? 'bg-surface-hover text-tree-ink-strong'
            : 'text-tree-ink hover:bg-surface-hover active:bg-pressed hover:text-tree-ink-strong',
      ]"
      :style="{ paddingLeft: `${6 + depth * 12}px` }"
      @click="activate"
      @pointerdown="onPointerDown"
      @contextmenu.prevent="emit('contextmenu', node, $event)"
    >
      <button
        type="button"
        data-tree-toggle
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
        :name="isGroup ? 'folderStack' : expanded ? 'folderOpen' : 'folder'"
        :size="14"
        class="mr-1.5 shrink-0"
        :class="isGroup ? 'text-ink-muted' : 'text-accent/85'"
      />
      <span class="min-w-0 flex-1 truncate" :title="displayName">{{ displayName }}</span>
    </div>

    <!--
      展開：`grid-template-rows` 由彈簧驅動（0fr → 1fr），所以收合時子節點要留到
      動畫結束才移除；完全收合的節點仍然不佔成本。
    -->
    <div v-if="mounted" class="grid" :style="childrenStyle">
      <div class="min-h-0 overflow-hidden">
        <p
          v-if="loading && !folderChildren.length"
          class="py-1 text-xs text-ink-faint"
          :style="{ paddingLeft: `${18 + depth * 12}px` }"
        >
          讀取中…
        </p>

        <!-- 虛擬目錄：內容是清單裡的真實資料夾，可以在這個容器內拖曳排序 -->
        <FolderTreeNode
          v-for="(child, index) in groupChildren"
          :key="child.id"
          :node="child"
          :depth="depth + 1"
          :pane-id="paneId"
          :container-id="node.id"
          :item-index="index"
          @contextmenu="forwardContextMenu"
        />

        <!-- 真實資料夾：內容是檔案系統的子資料夾，不屬於清單，因此不能拖曳排序 -->
        <FolderTreeNode
          v-for="child in folderChildren"
          :key="child.path"
          :node="{ id: child.path, label: child.name, kind: 'folder', path: child.path }"
          :depth="depth + 1"
          :pane-id="paneId"
          @contextmenu="forwardContextMenu"
        />

        <p
          v-if="isGroup && !groupChildren.length"
          class="py-1 text-xs text-ink-faint"
          :style="{ paddingLeft: `${18 + depth * 12}px` }"
        >
          這個虛擬目錄還沒有資料夾
        </p>
      </div>
    </div>
  </div>
</template>
