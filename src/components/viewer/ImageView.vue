<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useImageNavigation } from "@/composables/useImageNavigation";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";

/**
 * 圖片內容。
 *
 * 預設以 contain 置中（fit）；滾輪以游標為錨點縮放、拖曳平移、
 * 雙擊在「fit」與「實際大小 100%」之間切換。
 *
 * 左右兩側疊著半透明的「上一張／下一張」：順序與來源檔案清單一致，
 * 換圖時清單的選取也跟著跑（見 `composables/useImageNavigation.ts`）。
 */
const props = defineProps<{ paneId: PaneId }>();

const viewer = useViewerStore();
const state = computed(() => viewer.of(props.paneId));
const imageNav = useImageNavigation();

const canPrev = computed(() => imageNav.canStep(props.paneId, -1));
const canNext = computed(() => imageNav.canStep(props.paneId, 1));
/** 清單裡只有這一張圖（兩邊都切不動）時整組按鈕收起來，畫面留給圖片。 */
const showNav = computed(() => canPrev.value || canNext.value);

const stage = useTemplateRef<HTMLElement>("stage");
const image = useTemplateRef<HTMLImageElement>("image");

const scale = ref(1);
const offset = ref({ x: 0, y: 0 });
const dragging = ref(false);

const MIN_SCALE = 0.05;
const MAX_SCALE = 40;

/** fit 時畫面寬度 ÷ 原圖寬度；用來換算「實際大小 100%」要放大幾倍。 */
const fittedRatio = ref(1);

let pointerId: number | null = null;
let origin = { x: 0, y: 0, offsetX: 0, offsetY: 0 };

const transform = computed(
  () => `translate(${offset.value.x}px, ${offset.value.y}px) scale(${scale.value})`,
);

function reset() {
  scale.value = 1;
  offset.value = { x: 0, y: 0 };
  dragging.value = false;
}

// 換一張圖（或重新載入）就回到 fit。
watch(
  () => state.value?.blobUrl,
  () => {
    scale.value = 1;
    offset.value = { x: 0, y: 0 };
    fittedRatio.value = 1;
  },
);

function onImageLoad() {
  const element = image.value;
  if (element?.naturalWidth) {
    // clientWidth 不含 transform，所以這是不縮放時的實際顯示比例。
    fittedRatio.value = element.clientWidth / element.naturalWidth || 1;
  }
}

function onWheel(event: WheelEvent) {
  event.preventDefault();
  const element = stage.value;
  if (!element) {
    return;
  }

  const next = clamp(scale.value * Math.exp(-event.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
  const rect = element.getBoundingClientRect();
  const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const point = { x: event.clientX - center.x, y: event.clientY - center.y };
  const factor = next / scale.value;

  // 讓游標底下的那一點留在原地。
  offset.value = {
    x: point.x - (point.x - offset.value.x) * factor,
    y: point.y - (point.y - offset.value.y) * factor,
  };
  scale.value = next;
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) {
    return;
  }
  // 導覽按鈕是疊在圖片上的控制項，不是拖曳平移的起點；事件仍要冒泡到窗格，
  // 點按鈕才會把焦點窗格換過來。
  if (event.target instanceof Element && event.target.closest("[data-image-nav]")) {
    return;
  }
  pointerId = event.pointerId;
  dragging.value = true;
  origin = {
    x: event.clientX,
    y: event.clientY,
    offsetX: offset.value.x,
    offsetY: offset.value.y,
  };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value || event.pointerId !== pointerId) {
    return;
  }
  offset.value = {
    x: origin.offsetX + (event.clientX - origin.x),
    y: origin.offsetY + (event.clientY - origin.y),
  };
}

function endDrag(event: PointerEvent) {
  if (event.pointerId !== pointerId) {
    return;
  }
  pointerId = null;
  dragging.value = false;
}

function stepImage(delta: 1 | -1) {
  imageNav.step(props.paneId, delta);
}

/** 雙擊：fit ↔ 實際大小 100%。 */
function toggleZoom() {
  if (Math.abs(scale.value - 1) < 0.02) {
    scale.value = clamp(1 / (fittedRatio.value || 1), MIN_SCALE, MAX_SCALE);
    offset.value = { x: 0, y: 0 };
    return;
  }
  reset();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
</script>

<template>
  <div
    ref="stage"
    class="relative min-h-0 flex-1 overflow-hidden bg-canvas-dim"
    :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="endDrag"
    @pointercancel="endDrag"
    @dblclick="toggleZoom"
  >
    <div class="pointer-events-none flex h-full w-full items-center justify-center p-4">
      <img
        v-if="state?.blobUrl"
        ref="image"
        :src="state.blobUrl"
        :alt="state.name"
        draggable="false"
        class="max-h-full max-w-full select-none"
        :style="{ transform }"
        @load="onImageLoad"
      />
    </div>

    <!--
      半透明圓形按鈕：只有一層極淡的薄霧，靠箭頭本身表達這裡可以按（見下方 scoped 樣式）。
    -->
    <button
      v-if="showNav"
      type="button"
      data-image-nav
      class="image-nav absolute top-1/2 left-3 flex size-9 items-center justify-center rounded-full pressable"
      :disabled="!canPrev"
      title="上一張 (←)"
      aria-label="上一張"
      @dblclick.stop
      @click="stepImage(-1)"
    >
      <AppIcon name="chevronLeft" :size="20" />
    </button>
    <button
      v-if="showNav"
      type="button"
      data-image-nav
      class="image-nav absolute top-1/2 right-3 flex size-9 items-center justify-center rounded-full pressable"
      :disabled="!canNext"
      title="下一張 (→)"
      aria-label="下一張"
      @dblclick.stop
      @click="stepImage(1)"
    >
      <AppIcon name="chevronRight" :size="20" />
    </button>
  </div>
</template>

<style scoped>
/*
 * 極淡的圓底：只是提示「這裡有東西可以按」，不跟圖片搶注意力 —— 10% 薄霧、不加邊框、
 * 不加陰影。可讀性由箭頭本身負責（`--color-ink` 是實色，不靠半透明撐對比），所以系統
 * 要求減少透明度時不需要像浮動面板那樣改成不透明；停用的那一側連薄霧都拿掉，只留更淡
 * 的箭頭。
 */
.image-nav {
  background: color-mix(in oklab, var(--color-menu) 10%, transparent);
  color: var(--color-ink);
  cursor: pointer;
  backdrop-filter: blur(10px);
}

.image-nav:hover:enabled {
  background: color-mix(in oklab, var(--color-menu) 55%, transparent);
}

.image-nav:active:enabled {
  background: var(--color-pressed);
}

.image-nav:disabled {
  background: transparent;
  color: var(--color-ink-fainter);
  cursor: default;
}
</style>
