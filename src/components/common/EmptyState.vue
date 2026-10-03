<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import type { IconName } from "./icons";

withDefaults(
  defineProps<{
    icon?: IconName;
    title: string;
    description?: string;
  }>(),
  { icon: "folderOpen", description: "" },
);
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
    <div class="flex size-11 items-center justify-center rounded-full bg-surface-muted text-ink-faint">
      <AppIcon :name="icon" :size="22" />
    </div>
    <p class="text-base font-medium text-ink">{{ title }}</p>
    <p v-if="description" class="max-w-sm text-sm leading-relaxed text-ink-muted">{{ description }}</p>
    <slot />
  </div>
</template>
