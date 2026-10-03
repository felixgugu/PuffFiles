<script setup lang="ts">
import ChromeActions from "./ChromeActions.vue";
import TabStrip from "./TabStrip.vue";
import WindowControls from "./WindowControls.vue";
</script>

<template>
  <!-- 整條標題列都是拖曳區；按鈕本身沒有標記，所以仍可正常點擊。 -->
  <header
    data-tauri-drag-region
    class="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-chrome pr-0 pl-2"
  >
    <TabStrip />
    <ChromeActions />
    <WindowControls />
  </header>
</template>
