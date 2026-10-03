<script setup lang="ts">
import { ref, useTemplateRef } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useExplorerStore } from "@/stores/explorer";
import { useTabsStore } from "@/stores/tabs";
import { layoutIcon, layoutLabel } from "@/utils/layout";

const tabs = useTabsStore();
const explorer = useExplorerStore();

const strip = useTemplateRef<HTMLElement>("strip");

interface DragSession {
  index: number;
  startX: number;
  moved: boolean;
}

let drag: DragSession | null = null;
const draggingIndex = ref(-1);

function titleOf(tabId: string, paneId: string): string {
  void tabId;
  const pane = explorer.meta(paneId);
  return pane?.currentName || pane?.currentPath || "新分頁";
}

function pathOf(paneId: string): string {
  return explorer.meta(paneId)?.currentPath ?? "";
}

function onPointerDown(event: PointerEvent, index: number) {
  if (event.button !== 0) {
    return;
  }
  if ((event.target as HTMLElement).closest("[data-tab-close]")) {
    return;
  }
  drag = { index, startX: event.clientX, moved: false };
  draggingIndex.value = index;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

/** 拖曳排序：即時比對指標落在哪個分頁上，立刻搬動，讓結果連續可見。 */
function onPointerMove(event: PointerEvent) {
  const session = drag;
  if (!session) {
    return;
  }
  const dx = event.clientX - session.startX;
  if (!session.moved && Math.abs(dx) < 4) {
    return;
  }
  session.moved = true;

  const nodes = strip.value?.querySelectorAll<HTMLElement>("[data-tab-index]");
  if (!nodes) {
    return;
  }
  let target = session.index;
  nodes.forEach((node, index) => {
    const rect = node.getBoundingClientRect();
    if (event.clientX >= rect.left && event.clientX <= rect.right) {
      target = index;
    }
  });

  if (target !== session.index) {
    tabs.moveTab(session.index, target);
    session.index = target;
    session.startX = event.clientX;
    draggingIndex.value = target;
  }
}

function onPointerUp(event: PointerEvent, tabId: string) {
  const session = drag;
  drag = null;
  draggingIndex.value = -1;
  if (!session) {
    return;
  }
  (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  if (!session.moved) {
    tabs.activateTab(tabId);
  }
}

function onMiddleClick(event: MouseEvent, tabId: string) {
  if (event.button === 1) {
    event.preventDefault();
    tabs.closeTab(tabId);
  }
}
</script>

<template>
  <!--
    data-tauri-drag-region 只對「事件目標本身」生效，所以必須標在這個會撐滿
    剩餘寬度的元素上；self-stretch 讓它吃滿標題列高度，整片空白都能拖曳。
  -->
  <div
    ref="strip"
    data-tauri-drag-region
    class="scroll-area flex min-w-0 flex-1 items-center gap-1 self-stretch overflow-x-auto"
  >
    <div
      v-for="(tab, index) in tabs.tabs"
      :key="tab.id"
      :data-tab-index="index"
      class="group flex h-7 min-w-[112px] max-w-[210px] shrink-0 cursor-default items-center gap-2 rounded-md pr-1 pl-2.5 transition-colors duration-100"
      :class="[
        tab.id === tabs.activeTabId
          ? 'bg-surface text-ink shadow-sm'
          : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
        draggingIndex === index ? 'opacity-70' : '',
      ]"
      :title="`${pathOf(tab.activePaneId)}　·　${layoutLabel(tab)}`"
      @pointerdown="onPointerDown($event, index)"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp($event, tab.id)"
      @auxclick="onMiddleClick($event, tab.id)"
    >
      <!-- 圖示直接反映版面：一般／垂直分割／水平分割。 -->
      <AppIcon
        :name="layoutIcon(tab)"
        :size="13"
        class="shrink-0"
        :class="tab.id === tabs.activeTabId ? 'text-accent' : 'text-ink-faint'"
      />
      <span class="min-w-0 flex-1 truncate text-[12px]">{{ titleOf(tab.id, tab.activePaneId) }}</span>
      <button
        data-tab-close
        type="button"
        class="flex size-5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-hover hover:text-ink"
        title="關閉分頁 (Ctrl+W)"
        @click.stop="tabs.closeTab(tab.id)"
      >
        <AppIcon name="close" :size="11" />
      </button>
    </div>

    <button
      type="button"
      class="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-100 hover:bg-surface-hover hover:text-ink"
      title="新增分頁 (Ctrl+T)"
      @click="tabs.newTab()"
    >
      <AppIcon name="plus" :size="14" />
    </button>
  </div>
</template>
