import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { STORAGE_KEYS, readJson, writeJson } from "@/services/storage";
import type { HistoryEntry } from "@/types/fs";
import { normalizeKey } from "@/utils/path";

/** 瀏覽紀錄上限（需求：最多 100 筆、去重、由新到舊）。 */
export const HISTORY_LIMIT = 100;

/** 全域共用的資料夾瀏覽紀錄（MRU）。 */
export const useHistoryStore = defineStore("history", () => {
  const items = ref<HistoryEntry[]>(
    readJson<HistoryEntry[]>(STORAGE_KEYS.history, [], (value) => Array.isArray(value)).filter(
      (item) => item && typeof item.path === "string" && typeof item.name === "string",
    ),
  );

  watch(items, (value) => writeJson(STORAGE_KEYS.history, value), { deep: true });

  /** 只在資料夾「確實載入成功」後才記錄，避免把失敗路徑寫進歷史。 */
  function record(path: string, name: string) {
    if (!path) {
      return;
    }
    const key = normalizeKey(path);
    const rest = items.value.filter((item) => normalizeKey(item.path) !== key);
    items.value = [{ path, name, at: Date.now() }, ...rest].slice(0, HISTORY_LIMIT);
  }

  function remove(path: string) {
    const key = normalizeKey(path);
    items.value = items.value.filter((item) => normalizeKey(item.path) !== key);
  }

  function clear() {
    items.value = [];
  }

  return { items, record, remove, clear };
});

// setup store 內有非響應式快取（項目陣列、AbortController、子節點快取），
// 熱更新無法安全接手，整頁重載才能保證狀態一致；工作階段會從 localStorage 還原。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
