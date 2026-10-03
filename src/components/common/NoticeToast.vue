<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import { useUiStore } from "@/stores/ui";

const ui = useUiStore();

function runAction() {
  ui.noticeAction?.run();
  ui.dismissNotice();
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-150 ease-out"
    enter-from-class="translate-y-1 opacity-0"
    leave-active-class="transition duration-150 ease-in"
    leave-to-class="opacity-0"
  >
    <div
      v-if="ui.notice"
      class="material-menu absolute bottom-9 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full py-1.5 pr-1.5 pl-3.5 text-xs text-ink"
    >
      <AppIcon name="info" :size="14" class="text-accent" />
      <span>{{ ui.notice }}</span>
      <button
        v-if="ui.noticeAction"
        type="button"
        class="rounded-full px-2 py-0.5 text-[12px] font-medium text-accent transition-colors duration-75 hover:bg-accent-soft"
        @click="runAction()"
      >
        {{ ui.noticeAction.label }}
      </button>
    </div>
  </Transition>
</template>
