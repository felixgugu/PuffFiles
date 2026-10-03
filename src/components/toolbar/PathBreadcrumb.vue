<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useExplorerStore } from "@/stores/explorer";
import { useUiStore } from "@/stores/ui";
import type { PaneId } from "@/types/fs";
import { toSegments } from "@/utils/path";

const props = defineProps<{ paneId: PaneId }>();

const explorer = useExplorerStore();
const ui = useUiStore();

const isEditing = ref(false);
const draft = ref("");
const input = useTemplateRef<HTMLInputElement>("pathInput");

const pane = computed(() => explorer.meta(props.paneId));
const segments = computed(() => toSegments(pane.value?.currentPath ?? ""));

watch(
  () => ui.pathEditRequest,
  () => void startEditing(),
);

async function startEditing() {
  if (!pane.value?.currentPath) {
    return;
  }
  draft.value = pane.value.currentPath;
  isEditing.value = true;
  await nextTick();
  input.value?.focus();
  input.value?.select();
}

function commit() {
  const target = draft.value.trim();
  isEditing.value = false;
  if (target) {
    void explorer.navigate(props.paneId, target);
  }
}
</script>

<template>
  <div class="flex min-w-0 flex-1 items-center">
    <input
      v-if="isEditing"
      ref="pathInput"
      v-model="draft"
      type="text"
      spellcheck="false"
      class="h-7 w-full rounded-md border border-accent bg-surface px-2.5 text-base text-ink focus:outline-none"
      @keydown.enter.prevent="commit"
      @keydown.esc.prevent="isEditing = false"
      @blur="isEditing = false"
    />

    <div
      v-else
      class="scroll-area flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-md px-1.5 py-0.5"
      :title="pane?.currentPath"
      @dblclick="startEditing"
    >
      <template v-for="(segment, index) in segments" :key="segment.path">
        <AppIcon v-if="index > 0" name="chevronRight" :size="12" class="shrink-0 text-ink-faint" />
        <button
          type="button"
          class="h-6 shrink-0 rounded px-1.5 text-base whitespace-nowrap pressable"
          :class="
            index === segments.length - 1
              ? 'font-medium text-ink'
              : 'text-ink-muted hover:bg-surface-hover active:bg-pressed hover:text-ink'
          "
          @click="explorer.navigate(props.paneId, segment.path)"
        >
          {{ segment.label }}
        </button>
      </template>

      <button
        type="button"
        class="h-6 min-w-6 flex-1 rounded text-left"
        title="雙擊或按 Ctrl+L 可直接輸入路徑"
        @dblclick="startEditing"
      />
    </div>
  </div>
</template>
