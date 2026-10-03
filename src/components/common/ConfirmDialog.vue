<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from "vue";
import { useUiStore } from "@/stores/ui";

/**
 * 通用確認對話框。
 *
 * 只用在「需要使用者當下決定、而且決定有意義」的地方 —— 例如把樹外的資料夾
 * 加進清單。破壞性但可復原的操作（刪除進資源回收筒）刻意不問，留給 Windows。
 */
const ui = useUiStore();
const confirmButton = useTemplateRef<HTMLButtonElement>("confirmButton");

watch(
  () => ui.confirmState,
  async (state) => {
    if (!state) {
      return;
    }
    await nextTick();
    confirmButton.value?.focus();
  },
);
</script>

<template>
  <Transition
    enter-active-class="transition duration-100 ease-out"
    enter-from-class="scale-95 opacity-0"
    leave-active-class="transition duration-100 ease-in"
    leave-to-class="scale-95 opacity-0"
  >
    <div
      v-if="ui.confirmState"
      class="fixed inset-0 z-[60] flex items-start justify-center bg-black/25 pt-32"
      @click.self="ui.resolveConfirm(false)"
    >
      <div class="w-[24rem] rounded-xl border border-line bg-surface p-4 shadow-2xl">
        <h2 class="text-[13px] font-semibold text-ink">{{ ui.confirmState.title }}</h2>
        <p class="mt-2 text-[12px] leading-relaxed break-words text-ink-muted">
          {{ ui.confirmState.message }}
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="h-8 rounded-md border border-line px-3 text-[13px] text-ink transition-colors duration-75 hover:bg-surface-hover"
            @click="ui.resolveConfirm(false)"
          >
            {{ ui.confirmState.cancelText ?? "取消" }}
          </button>
          <button
            ref="confirmButton"
            type="button"
            class="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-ink transition-opacity duration-75 hover:opacity-90"
            @click="ui.resolveConfirm(true)"
          >
            {{ ui.confirmState.confirmText ?? "確定" }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
