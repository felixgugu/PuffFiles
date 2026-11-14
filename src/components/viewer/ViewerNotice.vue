<script setup lang="ts">
import AppIcon from "@/components/common/AppIcon.vue";

/**
 * 檢視器內容上方的一行提示（HTML 靜態模式、略過語法高亮…）。
 *
 * 只負責樣式，文字由呼叫端決定；需要一個動作（例如「用瀏覽器開啟」）時
 * 傳 `actionLabel`，按下時發出 `action`。
 */
defineProps<{ text: string; actionLabel?: string }>();

const emit = defineEmits<{ action: [] }>();
</script>

<template>
  <p
    class="flex shrink-0 items-center gap-2 border-b border-line bg-surface-muted px-3 py-1.5 text-xs text-ink-muted"
  >
    <AppIcon name="info" :size="13" class="shrink-0" />
    <span class="min-w-0 flex-1">{{ text }}</span>
    <button
      v-if="actionLabel"
      type="button"
      class="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
      @click="emit('action')"
    >
      <AppIcon name="externalLink" :size="12" />
      {{ actionLabel }}
    </button>
  </p>
</template>
