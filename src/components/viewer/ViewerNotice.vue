<script setup lang="ts">
import AppIcon from "@/components/common/AppIcon.vue";

/**
 * 檢視器內容上方的一行提示（HTML 靜態模式、略過語法高亮…）。
 *
 * 只負責樣式，文字由呼叫端決定。
 */
defineProps<{ text: string }>();
</script>

<template>
  <p
    class="flex shrink-0 items-center gap-2 border-b border-line bg-surface-muted px-3 py-1.5 text-xs text-ink-muted"
  >
    <AppIcon name="info" :size="13" class="shrink-0" />
    <span class="min-w-0 flex-1">{{ text }}</span>
  </p>
</template>
