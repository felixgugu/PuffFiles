<script setup lang="ts">
import { computed } from "vue";
import { ICON_PATHS, type IconName } from "./icons";

const props = withDefaults(
  defineProps<{
    name: IconName;
    /** 以 px 為單位的邊長。 */
    size?: number;
    strokeWidth?: number;
  }>(),
  { size: 18, strokeWidth: 1.7 },
);

const paths = computed(() => ICON_PATHS[props.name] as readonly string[]);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <path v-for="(d, index) in paths" :key="index" :d="d" />
  </svg>
</template>
