<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, nextTick, ref, useTemplateRef } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import type { MenuItem } from "@/types/menu";

const props = defineProps<{
  x: number;
  y: number;
  items: MenuItem[];
}>();

const emit = defineEmits<{
  select: [id: string];
  close: [];
}>();

const root = useTemplateRef<HTMLElement>("root");
const position = ref({ left: props.x, top: props.y });
const viewport = ref({ width: window.innerWidth, height: window.innerHeight });
/**
 * 選單比視窗還高的時候不能硬塞進去（下緣會超出畫面），改成限制高度並在裡面捲動。
 * 這裡先給上限，`place()` 量到的就是「已經有捲軸」的真正高度，翻位才會準。
 */
const maxHeight = computed(() => Math.max(120, viewport.value.height - 16));

const visible = computed(() => props.items.filter((item) => item.id !== ""));

/**
 * 靠近畫面邊緣時往內翻，選單永遠完整可見（空間一致性）。
 *
 * 量尺寸刻意用 `offsetWidth` / `offsetHeight` 而不是 `getBoundingClientRect()`：
 * 進場動畫帶著 `scale-95`，rect 會量到「還沒放大」的高度，翻位就會少算一截，
 * 選單下緣照樣被切掉。offset 系列不受 transform 影響，量到的是版面實際大小。
 */
async function place() {
  // 視窗尺寸有變才更新上限，避免每次開選單都多一次沒必要的重繪。
  if (window.innerWidth !== viewport.value.width || window.innerHeight !== viewport.value.height) {
    viewport.value = { width: window.innerWidth, height: window.innerHeight };
  }
  // 先讓新的 max-height 套用到 DOM，量到的高度才會是「已經有捲軸」的樣子。
  await nextTick();
  const element = root.value;
  if (!element) {
    return;
  }
  const margin = 8;
  const menuWidth = Math.ceil(element.offsetWidth);
  const menuHeight = Math.ceil(element.offsetHeight);
  const left = Math.min(props.x, viewport.value.width - menuWidth - margin);
  const top = Math.min(props.y, viewport.value.height - menuHeight - margin);
  position.value = { left: Math.max(margin, left), top: Math.max(margin, top) };
}

function onWindowResize() {
  void place();
}

function onWindowPointerDown(event: PointerEvent) {
  const target = event.target;
  if (target instanceof Node && root.value?.contains(target)) {
    return;
  }
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    emit("close");
  }
}

onMounted(() => {
  void place();
  window.addEventListener("pointerdown", onWindowPointerDown, true);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", onWindowResize);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onWindowPointerDown, true);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", onWindowResize);
});
</script>

<template>
  <Transition
    appear
    enter-active-class="transition duration-150 ease-out"
    enter-from-class="scale-95 opacity-0"
    leave-active-class="transition duration-100 ease-in"
    leave-to-class="scale-95 opacity-0"
  >
    <div
      ref="root"
      class="material-menu scroll-area fixed z-50 min-w-52 origin-top-left overflow-y-auto overscroll-contain rounded-lg py-1"
      :style="{
        left: `${position.left}px`,
        top: `${position.top}px`,
        maxHeight: `${maxHeight}px`,
      }"
    >
      <template v-for="item in visible" :key="item.id">
        <div v-if="item.separatorBefore" class="my-0.5 h-px bg-line" />
        <button
          type="button"
          class="flex w-full items-center gap-2.5 px-2.5 py-1 text-left text-sm pressable disabled:opacity-40"
          :class="
            item.disabled
              ? 'text-ink-faint'
              : 'text-ink hover:bg-accent hover:text-accent-ink'
          "
          :disabled="item.disabled"
          @click="emit('select', item.id)"
        >
          <AppIcon v-if="item.icon" :name="item.icon" :size="14" class="shrink-0 opacity-80" />
          <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
          <span v-if="item.shortcut" class="shrink-0 text-2xs opacity-60">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>
  </Transition>
</template>
