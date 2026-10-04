<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from "vue";
import { useUiStore } from "@/stores/ui";

/**
 * 三個以上選項的對話框（例如「取消／捨棄變更／儲存並離開」）。
 *
 * 只有兩個選項時請用 `ConfirmDialog`。這裡的第一個選項會取得焦點，
 * 所以呼叫端要把最安全的那個（通常是取消）放在最前面；Esc 與點背景都等於取消。
 */
const ui = useUiStore();
const root = useTemplateRef<HTMLElement>("root");

watch(
  () => ui.choiceState,
  async (state) => {
    if (!state) {
      return;
    }
    await nextTick();
    root.value?.querySelector<HTMLButtonElement>("button")?.focus();
  },
);

function toneClass(tone: "default" | "primary" | "danger" | undefined): string {
  if (tone === "primary") {
    return "bg-accent font-medium text-accent-ink hover:opacity-90 active:opacity-80";
  }
  if (tone === "danger") {
    return "border border-line text-danger hover:bg-danger-soft active:bg-danger-soft";
  }
  return "border border-line text-ink hover:bg-surface-hover active:bg-pressed";
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-100 ease-out"
    enter-from-class="scale-95 opacity-0"
    leave-active-class="transition duration-100 ease-in"
    leave-to-class="scale-95 opacity-0"
  >
    <div
      v-if="ui.choiceState"
      class="fixed inset-0 z-[60] flex items-start justify-center bg-black/25 pt-32"
      @click.self="ui.resolveChoice(null)"
    >
      <div ref="root" class="w-[24rem] rounded-xl border border-line bg-surface p-4 shadow-2xl">
        <h2 class="text-base font-semibold text-ink">{{ ui.choiceState.title }}</h2>
        <p v-if="ui.choiceState.message" class="mt-2 text-sm leading-relaxed break-words text-ink-muted">
          {{ ui.choiceState.message }}
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            v-for="option in ui.choiceState.options"
            :key="option.id"
            type="button"
            class="h-8 rounded-md px-3 text-base pressable"
            :class="toneClass(option.tone)"
            @click="ui.resolveChoice(option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
