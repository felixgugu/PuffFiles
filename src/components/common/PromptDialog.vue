<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from "vue";
import { useUiStore } from "@/stores/ui";

/**
 * 需要輸入名稱的對話框（建立資料夾／檔案）。
 *
 * 與 `ConfirmDialog` 分開：這裡的結果是字串而不是布林值，
 * 而且會依 `selectTo` 只選取主檔名，讓使用者可以直接輸入覆蓋。
 */
const ui = useUiStore();
const draft = ref("");
const input = useTemplateRef<HTMLInputElement>("input");

watch(
  () => ui.promptState,
  async (state) => {
    if (!state) {
      return;
    }
    draft.value = state.value ?? "";
    await nextTick();
    const element = input.value;
    element?.focus();
    element?.setSelectionRange(0, state.selectTo ?? draft.value.length);
  },
);

function confirm() {
  const value = draft.value.trim();
  if (value) {
    ui.resolvePrompt(value);
  }
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
      v-if="ui.promptState"
      class="fixed inset-0 z-[60] flex items-start justify-center bg-black/25 pt-32"
      @click.self="ui.resolvePrompt(null)"
    >
      <div class="w-[24rem] origin-top rounded-xl border border-line bg-surface p-4 shadow-2xl">
        <h2 class="text-base font-semibold text-ink">{{ ui.promptState.title }}</h2>
        <label v-if="ui.promptState.label" class="mt-3 block text-sm text-ink-muted">
          {{ ui.promptState.label }}
        </label>
        <input
          ref="input"
          v-model="draft"
          type="text"
          spellcheck="false"
          :placeholder="ui.promptState.placeholder"
          class="mt-1.5 h-8 w-full rounded-md border border-line bg-canvas px-2.5 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          @keydown.enter.prevent="confirm"
          @keydown.esc.prevent="ui.resolvePrompt(null)"
        />
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="pressable h-8 rounded-md border border-line px-3 text-base text-ink hover:bg-surface-hover active:bg-pressed"
            @click="ui.resolvePrompt(null)"
          >
            取消
          </button>
          <button
            type="button"
            class="pressable h-8 rounded-md bg-accent px-3 text-base font-medium text-accent-ink hover:opacity-90 active:opacity-80 disabled:opacity-40"
            :disabled="!draft.trim()"
            @click="confirm"
          >
            {{ ui.promptState.confirmText ?? "確定" }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
