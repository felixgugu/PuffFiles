import { defineStore } from "pinia";
import { computed, ref } from "vue";
import * as api from "@/services/api";
import { normalizeBackendError, type AppErrorView } from "@/services/errors";
import type { DriveInfo, QuickLocation } from "@/types/fs";

/** 磁碟機與快速存取位置的來源（開機載入一次即可）。 */
export const useSystemStore = defineStore("system", () => {
  const drives = ref<DriveInfo[]>([]);
  const quickLocations = ref<QuickLocation[]>([]);
  const isLoading = ref(false);
  const error = ref<AppErrorView | null>(null);

  const startLocation = computed(
    () => quickLocations.value.find((item) => item.kind === "home")?.path ?? drives.value[0]?.mountPoint ?? null,
  );

  async function load() {
    isLoading.value = true;
    error.value = null;
    try {
      const [loadedDrives, locations] = await Promise.all([api.listDrives(), api.quickLocations()]);
      drives.value = loadedDrives;
      quickLocations.value = locations;
    } catch (cause) {
      error.value = normalizeBackendError(cause);
    } finally {
      isLoading.value = false;
    }
  }

  return { drives, quickLocations, isLoading, error, startLocation, load };
});

// setup store 內有非響應式快取（項目陣列、AbortController、子節點快取），
// 熱更新無法安全接手，整頁重載才能保證狀態一致；工作階段會從 localStorage 還原。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
