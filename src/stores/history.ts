import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { STORAGE_KEYS, readJson, writeJson } from "@/services/storage";
import type { HistoryEntry, SplitDirection } from "@/types/fs";
import { normalizeKey } from "@/utils/path";

/** 瀏覽紀錄上限（需求：最多 100 筆、去重、由新到舊）。 */
export const HISTORY_LIMIT = 100;

/** 去重用的鍵：把整組路徑正規化後接起來。 */
function keyOf(paths: string[]): string {
  return paths.map(normalizeKey).join("\u0000");
}

/** 舊版只存單一路徑（`{ path, name }`），讀進來時轉成新的形狀。 */
function migrate(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      const value = item as Partial<HistoryEntry> & { path?: unknown };
      const paths = Array.isArray(value.paths)
        ? value.paths.filter((path): path is string => typeof path === "string")
        : typeof value.path === "string"
          ? [value.path]
          : [];
      return {
        paths,
        direction: value.direction,
        at: typeof value.at === "number" ? value.at : Date.now(),
      } satisfies HistoryEntry;
    })
    .filter((entry) => entry.paths.length > 0);
}

/** 全域共用的資料夾瀏覽紀錄（MRU）。 */
export const useHistoryStore = defineStore("history", () => {
  const items = ref<HistoryEntry[]>(
    migrate(readJson<unknown>(STORAGE_KEYS.history, [], (value) => Array.isArray(value))),
  );

  watch(items, (value) => writeJson(STORAGE_KEYS.history, value), { deep: true });

  /**
   * 記錄一次瀏覽：單窗是一個路徑，分割是「左／上 + 右／下」兩個路徑合併成一筆。
   * 只在資料夾確實載入成功後才呼叫，避免把失敗路徑寫進歷史。
   */
  function record(paths: string[], direction?: SplitDirection) {
    const clean = paths.filter(Boolean);
    if (clean.length === 0) {
      return;
    }
    const key = keyOf(clean);
    const rest = items.value.filter((item) => keyOf(item.paths) !== key);
    items.value = [
      { paths: clean, direction: clean.length > 1 ? direction : undefined, at: Date.now() },
      ...rest,
    ].slice(0, HISTORY_LIMIT);
  }

  function remove(entry: HistoryEntry) {
    const key = keyOf(entry.paths);
    items.value = items.value.filter((item) => keyOf(item.paths) !== key);
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
