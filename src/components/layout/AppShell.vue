<script setup lang="ts">
import { onMounted } from "vue";
import NoticeToast from "@/components/common/NoticeToast.vue";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import ChoiceDialog from "@/components/common/ChoiceDialog.vue";
import PromptDialog from "@/components/common/PromptDialog.vue";
import WindowChrome from "@/components/chrome/WindowChrome.vue";
import StatusBar from "@/components/layout/StatusBar.vue";
import SettingsView from "@/components/settings/SettingsView.vue";
import TabToolbar from "@/components/toolbar/TabToolbar.vue";
import WorkspaceView from "@/components/workspace/WorkspaceView.vue";
import { useKeyboardShortcuts } from "@/composables/useKeyboardShortcuts";
import * as api from "@/services/api";
import { useSettingsStore } from "@/stores/settings";
import { useSystemStore } from "@/stores/system";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";

const system = useSystemStore();
const tabs = useTabsStore();
const ui = useUiStore();
const settings = useSettingsStore();

useKeyboardShortcuts();

onMounted(async () => {
  // 內建工具（目前只有 7-Zip）開機偵測一次；只填空白的執行檔，不覆蓋使用者填過的值。
  void api
    .detect7zip()
    .then((path) => (path ? settings.applyDetected7zip(path) : undefined))
    .catch(() => undefined);
  await system.load();
  tabs.bootstrap(system.startLocation);
});
</script>

<template>
  <div class="relative flex h-full flex-col bg-canvas text-ink">
    <WindowChrome />

    <div class="relative flex min-h-0 flex-1 flex-col">
      <!-- 每個分頁只有一條路徑列，永遠指向焦點窗格。 -->
      <TabToolbar />
      <WorkspaceView />
      <StatusBar />

      <!--
        設定是整頁模式：浮在工作區之上（工作區保持掛載，捲動位置與窗格不會重來）。
        進出用淡入 + 微縮放，原點錨定在右上角的齒輪按鈕，符合「從哪裡出現就從哪裡消失」。
      -->
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="scale-[0.99] opacity-0"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="scale-[0.99] opacity-0"
      >
        <SettingsView
          v-if="ui.settingsOpen"
          class="absolute inset-0 z-30 origin-top-right"
        />
      </Transition>
    </div>

    <NoticeToast />
    <ConfirmDialog />
    <ChoiceDialog />
    <PromptDialog />
  </div>
</template>
