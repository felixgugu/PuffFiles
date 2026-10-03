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

const visible = computed(() => props.items.filter((item) => item.id !== ""));

/** 靠近畫面邊緣時往內翻，選單永遠完整可見（空間一致性）。 */
async function place() {
  await nextTick();
  const element = root.value;
  if (!element) {
    return;
  }
  const rect = element.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(props.x, window.innerWidth - rect.width - margin);
  const top = Math.min(props.y, window.innerHeight - rect.height - margin);
  position.value = { left: Math.max(margin, left), top: Math.max(margin, top) };
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
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onWindowPointerDown, true);
  window.removeEventListener("keydown", onKeydown);
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
      class="material-menu fixed z-50 min-w-52 origin-top-left rounded-lg py-1"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    >
      <template v-for="item in visible" :key="item.id">
        <div v-if="item.separatorBefore" class="my-1 h-px bg-line" />
        <button
          type="button"
          class="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-base pressable disabled:opacity-40"
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
          <span v-if="item.shortcut" class="shrink-0 text-xs opacity-60">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>
  </Transition>
</template>
