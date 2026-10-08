import { computed } from "vue";
import { defineStore } from "pinia";
import { useExplorerStore } from "@/stores/explorer";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import type { FileEntry, PaneId } from "@/types/fs";
import { compareEntry, compareKey, indexByName, type CompareState } from "@/utils/compare";

/** 一個窗格可見清單裡的比對統計。 */
export interface CompareCounts {
  /** 只在這一邊有（另一邊要補過來才能對齊）。 */
  only: number;
  /** 兩邊都有但不同。 */
  different: number;
}

/**
 * 目錄比對（見 §同步瀏覽與目錄比對）。
 *
 * 只在分割時有意義。做法是把**另一個窗格**的完整清單做成「小寫檔名 → 項目」的索引，
 * 畫面上的每一列再拿自己的檔名去查 —— 兩個窗格各自用對方當索引，所以兩邊都會上色。
 * 狀態本身不住在這裡（它是衍生的），這個 store 只負責在清單變動時重建索引。
 */
export const useCompareStore = defineStore("compare", () => {
  const explorer = useExplorerStore();
  const settings = useSettingsStore();
  const tabs = useTabsStore();

  /** 比對是否正在生效：開關打開、而且焦點分頁真的分割了。 */
  const enabled = computed(() => settings.compareDirectories && tabs.isSplit);

  /**
   * 每個窗格的「另一邊索引」。
   *
   * 另一邊還在載入時刻意不建：串流的每一批都會換掉陣列，若跟著重建索引等於
   * 每批都做一次 O(n) 的白工，顏色等兩邊都載完再出現就好。
   */
  const indexes = computed(() => {
    const result = new Map<PaneId, Map<string, FileEntry>>();
    const tab = tabs.activeTab;
    if (!enabled.value || !tab || tab.paneIds.length < 2) {
      return result;
    }
    for (const paneId of tab.paneIds) {
      const other = tab.paneIds.find((id) => id !== paneId);
      if (!other || explorer.meta(other)?.status !== "ready") {
        continue;
      }
      result.set(paneId, indexByName(explorer.entries(other)));
    }
    return result;
  });

  /** 這一列在另一邊的狀態；相同、關閉比對或另一邊還沒好時回 null（不上色）。 */
  function statusFor(paneId: PaneId, entry: FileEntry): CompareState | null {
    const index = indexes.value.get(paneId);
    if (!index) {
      return null;
    }
    return compareEntry(entry, index.get(compareKey(entry.name)));
  }

  /** 可見清單的統計（與狀態列顯示的筆數一致 —— 看到什麼就數什麼）。 */
  function counts(paneId: PaneId): CompareCounts {
    const result: CompareCounts = { only: 0, different: 0 };
    if (!enabled.value) {
      return result;
    }
    for (const entry of explorer.visibleRef(paneId)?.value ?? []) {
      const state = statusFor(paneId, entry);
      if (state) {
        result[state] += 1;
      }
    }
    return result;
  }

  return { enabled, statusFor, counts };
});
