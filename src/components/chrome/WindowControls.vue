<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { closeWindow, isWindowMaximized, minimizeWindow, toggleMaximizeWindow, watchMaximized } from "@/services/window";

const maximized = ref(false);
let dispose: (() => void) | null = null;

onMounted(async () => {
  maximized.value = await isWindowMaximized();
  dispose = watchMaximized((value) => {
    maximized.value = value;
  });
});

onBeforeUnmount(() => dispose?.());
</script>

<template>
  <div class="ml-1 flex h-full items-stretch">
    <button
      type="button"
      class="flex w-11 items-center justify-center text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink active:bg-surface-hover"
      title="最小化"
      @click="minimizeWindow()"
    >
      <AppIcon name="winMinimize" :size="15" />
    </button>
    <button
      type="button"
      class="flex w-11 items-center justify-center text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink active:bg-surface-hover"
      :title="maximized ? '還原' : '放大'"
      @click="toggleMaximizeWindow()"
    >
      <AppIcon :name="maximized ? 'winRestore' : 'winMaximize'" :size="14" />
    </button>
    <button
      type="button"
      class="flex w-11 items-center justify-center text-ink-muted pressable hover:bg-danger hover:text-white active:bg-danger"
      title="關閉"
      @click="closeWindow()"
    >
      <AppIcon name="close" :size="15" />
    </button>
  </div>
</template>
