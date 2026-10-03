<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import type { AppErrorView } from "@/services/errors";

defineProps<{ error: AppErrorView }>();

defineEmits<{
  dismiss: [];
  retry: [];
}>();
</script>

<template>
  <div
    role="alert"
    class="m-3 flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5"
  >
    <AppIcon name="alert" :size="18" class="mt-0.5 text-danger" />
    <div class="min-w-0 flex-1">
      <p class="text-base font-medium text-ink">{{ error.title }}</p>
      <p class="mt-0.5 text-sm break-words text-ink-muted">{{ error.message }}</p>
    </div>
    <button
      type="button"
      class="rounded px-2 py-1 text-sm text-ink-muted hover:bg-surface-hover active:bg-pressed hover:text-ink"
      @click="$emit('retry')"
    >
      重試
    </button>
    <button
      type="button"
      class="rounded p-1 text-ink-muted hover:bg-surface-hover active:bg-pressed hover:text-ink"
      title="關閉"
      @click="$emit('dismiss')"
    >
      <AppIcon name="close" :size="14" />
    </button>
  </div>
</template>
