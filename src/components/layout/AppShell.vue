<script setup lang="ts">
import { onMounted } from "vue";
import NoticeToast from "@/components/common/NoticeToast.vue";
import WindowChrome from "@/components/chrome/WindowChrome.vue";
import StatusBar from "@/components/layout/StatusBar.vue";
import SettingsSheet from "@/components/overlays/SettingsSheet.vue";
import TabToolbar from "@/components/toolbar/TabToolbar.vue";
import WorkspaceView from "@/components/workspace/WorkspaceView.vue";
import { useKeyboardShortcuts } from "@/composables/useKeyboardShortcuts";
import { useSystemStore } from "@/stores/system";
import { useTabsStore } from "@/stores/tabs";

const system = useSystemStore();
const tabs = useTabsStore();

useKeyboardShortcuts();

onMounted(async () => {
  await system.load();
  tabs.bootstrap(system.startLocation);
});
</script>

<template>
  <div class="relative flex h-full flex-col bg-canvas text-ink">
    <WindowChrome />
    <!-- 每個分頁只有一條路徑功能列，永遠指向焦點窗格。 -->
    <TabToolbar />
    <WorkspaceView />
    <StatusBar />
    <NoticeToast />
    <SettingsSheet />
  </div>
</template>
