import { defineStore } from "pinia";
import { computed, ref } from "vue";
import * as api from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { useUiStore } from "@/stores/ui";
import type { DriveInfo, QuickLocation } from "@/types/fs";

/**
 * 系統環境來源：磁碟機與快速存取位置。
 *
 * 只用在「開機時要開在哪個資料夾」這一個決策上 —— 側邊欄已經移除，
 * 所以這裡不保存額外的載入狀態，取不到就直接退回 null。
 */
export const useSystemStore = defineStore("system", () => {
  const ui = useUiStore();

  const drives = ref<DriveInfo[]>([]);
  const quickLocations = ref<QuickLocation[]>([]);

  const startLocation = computed(
    () =>
      quickLocations.value.find((item) => item.kind === "home")?.path ??
      drives.value[0]?.mountPoint ??
      null,
  );

  async function load() {
    try {
      const [loadedDrives, locations] = await Promise.all([api.listDrives(), api.quickLocations()]);
      drives.value = loadedDrives;
      quickLocations.value = locations;
    } catch (cause) {
      ui.showNotice(normalizeBackendError(cause).message, undefined, 4000);
    }
  }

  return { startLocation, load };
});

if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
