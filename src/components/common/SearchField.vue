<script setup lang="ts">
import { useTemplateRef, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import { useUiStore } from "@/stores/ui";

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });

/** 使用 `defineModel`（Vue 3.4+）雙向綁定搜尋字串。 */
const keyword = defineModel<string>({ default: "" });

const ui = useUiStore();
const input = useTemplateRef<HTMLInputElement>("input");

watch(
  () => ui.searchFocusRequest,
  () => {
    if (!props.active) {
      return;
    }
    input.value?.focus();
    input.value?.select();
  },
);
</script>

<template>
  <div
    class="flex h-8 w-56 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-ink-muted transition focus-within:border-accent focus-within:text-ink"
  >
    <AppIcon name="search" :size="15" />
    <input
      ref="input"
      v-model="keyword"
      type="text"
      spellcheck="false"
      placeholder="搜尋目前資料夾"
      class="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none"
    />
    <button
      v-if="keyword"
      type="button"
      class="rounded p-0.5 text-ink-faint hover:bg-surface-hover active:bg-pressed hover:text-ink"
      title="清除搜尋"
      @click="keyword = ''"
    >
      <AppIcon name="close" :size="13" />
    </button>
  </div>
</template>
