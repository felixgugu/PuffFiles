<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import MenuPanel from "@/components/overlays/MenuPanel.vue";
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
const submenuEl = useTemplateRef<HTMLElement>("submenuEl");
const position = ref({ left: props.x, top: props.y });
const viewport = ref({ width: window.innerWidth, height: window.innerHeight });
/**
 * 選單比視窗還高的時候不能硬塞進去（下緣會超出畫面），改成限制高度並在裡面捲動。
 * 這裡先給上限，`place()` 量到的就是「已經有捲軸」的真正高度，翻位才會準。
 */
const maxHeight = computed(() => Math.max(120, viewport.value.height - 16));

interface SubmenuState {
  /** 展開中的入口列。 */
  item: MenuItem;
  /** 入口列的邊界；翻面與夾回畫面內時要靠它重算（捲動或換列都會重設）。 */
  rect: DOMRect;
  left: number;
  top: number;
  /** 量過尺寸、位置算好了；在那之前先隱形，免得在錯的位置閃一下。 */
  placed: boolean;
}

const submenu = ref<SubmenuState | null>(null);
const activeId = computed(() => submenu.value?.item.id);

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

/**
 * 展開入口列的子選單。
 *
 * 先放在入口列的右側、上緣切齊，量到真正尺寸後才決定要不要翻到左邊、
 * 以及往下夾回畫面內 —— 順序反過來就量不到寬高（元素還不存在）。
 */
async function openSubmenu(item: MenuItem, event: PointerEvent) {
  // 同一個入口列（例如從子選單滑回來）就維持現狀，不要重新量測造成閃一下。
  if (submenu.value?.item.id === item.id) {
    return;
  }
  const row = event.currentTarget;
  if (!(row instanceof HTMLElement)) {
    return;
  }
  const rect = row.getBoundingClientRect();
  submenu.value = { item, rect, left: rect.right + 2, top: rect.top, placed: false };

  await nextTick();
  const state = submenu.value;
  const element = submenuEl.value;
  if (!state || !element) {
    return;
  }
  const margin = 8;
  const width = Math.ceil(element.offsetWidth);
  const height = Math.ceil(element.offsetHeight);
  let left = state.rect.right + 2;
  if (left + width > viewport.value.width - margin) {
    left = state.rect.left - width - 2;
  }
  left = Math.min(Math.max(margin, left), Math.max(margin, viewport.value.width - width - margin));
  const top = Math.min(
    Math.max(margin, state.rect.top),
    Math.max(margin, viewport.value.height - height - margin),
  );
  submenu.value = { ...state, left, top, placed: true };
}

/** 父選單的列：有子選單就展開，其他列則把子選單收掉（與 Windows 選單一致）。 */
function onHover(item: MenuItem, event: PointerEvent) {
  if (item.children?.length) {
    void openSubmenu(item, event);
    return;
  }
  submenu.value = null;
}

/** 子選單只有一層，滑過子選項不會再展開或收起任何東西。 */
function onSubmenuHover() {
  // 刻意留空：`MenuPanel` 的 hover 事件在這一層沒有對應的狀態可改。
}

/** 父選單捲動時入口列已經移位，直接收起子選單比跟著重算單純。 */
function onMenuScroll() {
  submenu.value = null;
}

function onWindowResize() {
  submenu.value = null;
  void place();
}

function onWindowPointerDown(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof Node)) {
    return;
  }
  // 子選單以 Teleport 掛在 body 上，不在 root 裡面，要另外判斷。
  if (root.value?.contains(target) || submenuEl.value?.contains(target)) {
    return;
  }
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    emit("close");
  }
}

// 選單內容整個換掉時（例如「加入我的資料夾」換成挑容器那一層），舊的子選單已經沒意義。
watch(
  () => props.items,
  () => {
    submenu.value = null;
    void place();
  },
);

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
      class="fixed z-50 min-w-52 origin-top-left"
      :style="{
        left: `${position.left}px`,
        top: `${position.top}px`,
      }"
    >
      <MenuPanel
        :items="items"
        :max-height="maxHeight"
        :active-id="activeId"
        @select="emit('select', $event)"
        @hover="onHover"
        @scroll="onMenuScroll"
      />
    </div>
  </Transition>

  <!--
    子選單掛在 body 上：父層帶著 `fixed` 定位與進場的 `scale`（會變成子元素的
    定位基準），留在裡面會讓座標算錯、也會被選單自己的堆疊脈絡綁住。
  -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-75 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="submenu"
        ref="submenuEl"
        class="fixed z-50"
        :style="{
          left: `${submenu.left}px`,
          top: `${submenu.top}px`,
          visibility: submenu.placed ? 'visible' : 'hidden',
        }"
      >
        <MenuPanel
          :items="submenu.item.children ?? []"
          :max-height="maxHeight"
          @select="emit('select', $event)"
          @hover="onSubmenuHover"
        />
      </div>
    </Transition>
  </Teleport>
</template>
