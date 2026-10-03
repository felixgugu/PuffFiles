<script setup lang="ts">
import { onMounted } from "vue";
import NoticeToast from "@/components/common/NoticeToast.vue";
import WindowChrome from "@/components/chrome/WindowChrome.vue";
import StatusBar from "@/components/layout/StatusBar.vue";
import SettingsView from "@/components/settings/SettingsView.vue";
import TabToolbar from "@/components/toolbar/TabToolbar.vue";
import WorkspaceView from "@/components/workspace/WorkspaceView.vue";
import { useKeyboardShortcuts } from "@/composables/useKeyboardShortcuts";
import { useSystemStore } from "@/stores/system";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";

const system = useSystemStore();
const tabs = useTabsStore();
const ui = useUiStore();

useKeyboardShortcuts();

onMounted(async () => {
  await system.load();
  tabs.bootstrap(system.startLocation);
});
</script>

<template>
  <div class="relative flex h-full flex-col bg-canvas text-ink">
    <WindowChrome />

    <!-- 設定是整頁模式：蓋掉工具列與內容，但保留標題列與視窗控制。 -->
    <SettingsView v-if="ui.settingsOpen" />
    <template v-else>
      <!-- 每個分頁只有一條路徑功能列，永遠指向焦點窗格。 -->
      <TabToolbar />
      <WorkspaceView />
      <StatusBar />
    </template>

    <NoticeToast />
  </div>
</template>
