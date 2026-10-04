<script setup lang="ts">
import { computed, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import FolderTreePanel from "@/components/tree/FolderTreePanel.vue";
import BrowserPane from "./BrowserPane.vue";
import { useDragGesture } from "@/composables/useDragGesture";
import { useSpringValue } from "@/composables/useSpringValue";
import { useSettingsStore } from "@/stores/settings";
import { MAX_RATIO, MIN_RATIO, useTabsStore } from "@/stores/tabs";
import { rubberband, SPRINGS } from "@/utils/spring";

/**
 * 分頁的內容區：左邊一份共用的資料夾樹，右邊是 1～2 個窗格。
 *
 * 窗格裡只放檔案清單，所以分割時畫面不會變成「兩棵樹 + 兩條路徑列」。
 */
const tabs = useTabsStore();
const settings = useSettingsStore();

const paneArea = useTemplateRef<HTMLElement>("paneArea");

const paneIds = computed(() => tabs.activeTab?.paneIds ?? []);
const direction = computed(() => tabs.activeTab?.direction ?? "row");
const isSplit = computed(() => paneIds.value.length > 1);
const ratio = computed(() => tabs.activeTab?.ratio ?? 0.5);

/**
 * 樹只由使用者自己收合（樹工具列的收合側欄或 F6）。
 *
 * 分割比例與視窗尺寸都不會讓它退場：上下分割根本不壓縮寬度，收掉樹也換不到高度；
 * 左右分割把窗格壓窄時，判定「太擠」而自動消失同樣會讓版面自己跳動。
 */
const showTree = computed(() => !settings.treeCollapsed);

const ratioSpring = useSpringValue(0.5, SPRINGS.panel);

// 回彈時由彈簧驅動比例，維持「放手後仍連續」的手感。
watch(ratioSpring.value, (value) => {
  const tab = tabs.activeTab;
  if (tab) {
    tab.ratio = Math.min(Math.max(value, 0.02), 0.98);
  }
  // 收合動畫走到終點才真的把窗格收掉。
  if (tabs.collapsing && value >= 0.97) {
    ratioSpring.stop();
    tabs.finishUnsplit();
  }
});

/** 分割：新窗格從邊緣長出來（比例由接近全滿彈到對半）。 */
watch(
  () => tabs.activeTab?.paneIds.length ?? 0,
  (count, previous) => {
    const tab = tabs.activeTab;
    if (!tab || count <= (previous ?? 0) || count < 2 || settings.reduceMotion) {
      return;
    }
    // 同步寫入，第一個畫格就是「幾乎全滿」，不會先閃一下對半。
    tab.ratio = 0.985;
    ratioSpring.jump(0.985);
    ratioSpring.set(0.5);
  },
  { flush: "sync" },
);

/** 收合：比例彈回接近全滿，動畫結束才真的銷毀。 */
watch(
  () => tabs.collapsing,
  (collapsing) => {
    const tab = tabs.activeTab;
    if (!collapsing || !tab) {
      return;
    }
    if (settings.reduceMotion) {
      tabs.finishUnsplit();
      return;
    }
    ratioSpring.jump(tab.ratio);
    ratioSpring.set(0.985);
  },
);

let bounds = { left: 0, top: 0, width: 0, height: 0 };

function axisSize(): number {
  return direction.value === "row" ? bounds.width : bounds.height;
}

const drag = useDragGesture({
  onStart: () => {
    // 動畫途中抓住分割線 → 立刻停掉彈簧，從當下值接手。
    ratioSpring.stop();
    const rect = paneArea.value?.getBoundingClientRect();
    if (rect) {
      bounds = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
  },
  onMove: (state) => {
    const tab = tabs.activeTab;
    const total = axisSize();
    if (!tab || total <= 0) {
      return;
    }
    const position = direction.value === "row" ? state.x - bounds.left : state.y - bounds.top;
    const raw = position / total;

    // 橡皮筋：越過可視範圍時漸進抵抗，而不是硬停。
    const next =
      raw < MIN_RATIO
        ? MIN_RATIO - rubberband(MIN_RATIO - raw, 1)
        : raw > MAX_RATIO
          ? MAX_RATIO + rubberband(raw - MAX_RATIO, 1)
          : raw;
    tabs.setRatio(tab.id, next, false);
  },
  onEnd: (state) => {
    const tab = tabs.activeTab;
    if (!tab) {
      return;
    }
    const total = axisSize();
    const clamped = Math.min(Math.max(tab.ratio, MIN_RATIO), MAX_RATIO);
    ratioSpring.jump(tab.ratio);
    ratioSpring.set(clamped, total > 0 ? state.velocityX / total : 0);
  },
});

/** 雙擊分隔線＝回到對半。 */
function resetRatio() {
  ratioSpring.jump(tabs.activeTab?.ratio ?? 0.5);
  ratioSpring.set(0.5);
}
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <FolderTreePanel v-if="showTree" />

    <div v-else class="flex w-9 shrink-0 flex-col items-center border-r border-line bg-rail pt-2">
      <button
        type="button"
        class="flex size-7 active:scale-95 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        title="展開資料夾清單 (F6)"
        @click="settings.toggleTree()"
      >
        <AppIcon name="panelLeft" :size="15" />
      </button>
    </div>

    <div
      ref="paneArea"
      class="relative flex min-h-0 min-w-0 flex-1"
      :class="direction === 'row' ? 'flex-row' : 'flex-col'"
    >
      <div
        v-if="paneIds[0]"
        class="flex min-h-0 min-w-0"
        :class="isSplit ? '' : 'flex-1'"
        :style="isSplit ? { flexBasis: `${ratio * 100}%`, flexGrow: 0, flexShrink: 0 } : undefined"
      >
        <BrowserPane :key="paneIds[0]" :pane-id="paneIds[0]" />
      </div>

      <template v-if="isSplit && paneIds[1]">
        <div
          class="group relative z-20 flex shrink-0 items-center justify-center"
          :class="
            direction === 'row' ? 'h-full w-1.5 cursor-col-resize' : 'h-1.5 w-full cursor-row-resize'
          "
          title="拖曳調整大小，雙擊回到對半"
          @pointerdown="drag.onPointerDown"
          @dblclick="resetRatio()"
        >
          <div
            class="pressable group-hover:bg-accent"
            :class="[
              direction === 'row' ? 'h-full w-px' : 'h-px w-full',
              drag.dragging.value ? 'bg-accent' : 'bg-line',
            ]"
          />
        </div>

        <div class="flex min-h-0 min-w-0 flex-1">
          <BrowserPane :key="paneIds[1]" :pane-id="paneIds[1]" />
        </div>
      </template>
    </div>
  </div>
</template>
