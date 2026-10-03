<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from "vue";
import AppIcon from "./AppIcon.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    label?: string;
    placeholder?: string;
    confirmText?: string;
  }>(),
  { label: "", placeholder: "", confirmText: "確定" },
);

const value = defineModel<string>("value", { default: "" });

const emit = defineEmits<{
  confirm: [value: string];
  cancel: [];
}>();

const input = useTemplateRef<HTMLInputElement>("input");

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      return;
    }
    value.value = "";
    await nextTick();
    input.value?.focus();
  },
);

function confirm() {
  const trimmed = value.value.trim();
  if (trimmed) {
    emit("confirm", trimmed);
  }
}

function cancel() {
  emit("cancel");
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-100 ease-out"
    enter-from-class="opacity-0"
    leave-active-class="transition duration-100 ease-in"
    leave-to-class="opacity-0"
  >
    <div
      v-if="open"
      class="fixed inset-0 z-40 flex items-start justify-center bg-black/25 pt-28"
      @click.self="cancel"
    >
      <div class="w-80 rounded-xl border border-line bg-surface p-4 shadow-2xl">
        <div class="flex items-center justify-between">
          <h2 class="text-[13px] font-semibold text-ink">{{ title }}</h2>
          <button
            type="button"
            class="rounded p-1 text-ink-muted hover:bg-surface-hover hover:text-ink"
            title="關閉"
            @click="cancel"
          >
            <AppIcon name="close" :size="14" />
          </button>
        </div>
        <label v-if="label" class="mt-3 block text-xs text-ink-muted">{{ label }}</label>
        <input
          ref="input"
          v-model="value"
          type="text"
          spellcheck="false"
          :placeholder="placeholder"
          class="mt-1.5 h-8 w-full rounded-md border border-line bg-canvas px-2.5 text-[13px] text-ink focus:border-accent focus:outline-none"
          @keydown.enter.prevent="confirm"
          @keydown.esc.prevent="cancel"
        />
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="h-8 rounded-md border border-line px-3 text-[13px] text-ink hover:bg-surface-hover"
            @click="cancel"
          >
            取消
          </button>
          <button
            type="button"
            class="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-ink hover:opacity-90 disabled:opacity-40"
            :disabled="!value.trim()"
            @click="confirm"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
