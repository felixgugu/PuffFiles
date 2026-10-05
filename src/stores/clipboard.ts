import { defineStore } from "pinia";
import { ref } from "vue";
import * as api from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { useExplorerStore } from "@/stores/explorer";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import { joinPath, normalizeKey, parentOf, samePath } from "@/utils/path";

/**
 * 剪貼簿與檔案操作。
 *
 * 真正的檔案搬移／複製／刪除都交給 Windows shell（含衝突對話框、進度、取消、
 * 資源回收筒），這裡只負責：把選取項目寫進系統剪貼簿、記錄「哪些項目被剪下」
 * 好讓清單淡化顯示、以及操作完成後重讀畫面上的資料夾。
 */
export const useClipboardStore = defineStore("clipboard", () => {
  const explorer = useExplorerStore();
  const tabs = useTabsStore();
  const ui = useUiStore();
  const viewer = useViewerStore();

  /** 被剪下的項目（正規化鍵）；清單據此淡化顯示。 */
  const cutKeys = ref<string[]>([]);
  /** 有檔案操作進行中（shell 正在顯示進度對話框）。 */
  const busy = ref(false);

  function isCut(path: string): boolean {
    return cutKeys.value.includes(normalizeKey(path));
  }

  function selectionOf(paneId: PaneId): string[] {
    return [...(explorer.meta(paneId)?.selected ?? [])];
  }

  function report(cause: unknown) {
    ui.showNotice(normalizeBackendError(cause).message, undefined, 4200);
  }

  /** 畫面上被打開的每一個窗格都重讀，這樣另一邊的變動也會立刻出現。 */
  async function refreshPanes() {
    const paneIds = tabs.tabs.flatMap((tab) => tab.paneIds);
    await Promise.all(paneIds.map((id) => explorer.refresh(id)));
  }

  async function put(paths: string[], cut: boolean) {
    if (!paths.length) {
      ui.showNotice("請先選取項目");
      return;
    }
    try {
      await api.setClipboardFiles(paths, cut);
      cutKeys.value = cut ? paths.map(normalizeKey) : [];
      ui.showNotice(cut ? `已剪下 ${paths.length} 個項目` : `已複製 ${paths.length} 個項目`);
    } catch (cause) {
      report(cause);
    }
  }

  function copySelection(paneId: PaneId) {
    return put(selectionOf(paneId), false);
  }

  function cutSelection(paneId: PaneId) {
    return put(selectionOf(paneId), true);
  }

  /** 貼上（來源可以是檔案總管）；`into` 省略時貼到該窗格目前的資料夾。 */
  async function paste(paneId: PaneId, into?: string) {
    if (busy.value) {
      return;
    }
    const destination = into ?? explorer.meta(paneId)?.currentPath;
    if (!destination) {
      return;
    }
    try {
      const clip = await api.clipboardFiles();
      if (!clip.paths.length) {
        ui.showNotice("剪貼簿裡沒有檔案");
        return;
      }

      busy.value = true;
      const completed = clip.cut
        ? await api.moveItems(clip.paths, destination)
        : await api.copyItems(clip.paths, destination);

      if (!completed) {
        ui.showNotice("操作已取消");
        return;
      }

      if (clip.cut) {
        cutKeys.value = [];
        // 搬移完就沒有「來源」可以再貼了，清掉以免第二次貼上指向不存在的位置。
        await api.clearClipboard().catch(() => undefined);
      }

      const count = clip.paths.length;
      ui.showNotice(clip.cut ? `已搬移 ${count} 個項目` : `已複製 ${count} 個項目`);
      await refreshPanes();
    } catch (cause) {
      report(cause);
    } finally {
      busy.value = false;
    }
  }

  /** 直接在兩個窗格之間複製或搬移，不經過剪貼簿。 */
  async function transfer(from: PaneId, to: PaneId, mode: "copy" | "move") {
    if (busy.value) {
      return;
    }
    const sources = selectionOf(from);
    const destination = explorer.meta(to)?.currentPath;
    if (!sources.length) {
      ui.showNotice("請先在這個窗格選取項目");
      return;
    }
    if (!destination) {
      return;
    }

    try {
      busy.value = true;
      const completed =
        mode === "copy"
          ? await api.copyItems(sources, destination)
          : await api.moveItems(sources, destination);

      if (!completed) {
        ui.showNotice("操作已取消");
        return;
      }

      if (mode === "move") {
        const moved = new Set(sources.map(normalizeKey));
        cutKeys.value = cutKeys.value.filter((key) => !moved.has(key));
      }

      ui.showNotice(
        mode === "copy"
          ? `已複製 ${sources.length} 個項目到另一個窗格`
          : `已搬移 ${sources.length} 個項目到另一個窗格`,
      );
      await refreshPanes();
    } catch (cause) {
      report(cause);
    } finally {
      busy.value = false;
    }
  }

  /** 刪除（預設進資源回收筒，確認與否由 Windows 決定）。 */
  async function removePaths(targets: string[]) {
    if (busy.value) {
      return;
    }
    if (!targets.length) {
      ui.showNotice("請先選取項目");
      return;
    }

    try {
      busy.value = true;
      const completed = await api.deleteItems(targets);
      if (!completed) {
        ui.showNotice("操作已取消");
        return;
      }
      ui.showNotice(`已刪除 ${targets.length} 個項目`);
      await refreshPanes();
    } catch (cause) {
      report(cause);
    } finally {
      busy.value = false;
    }
  }

  /** 把焦點窗格的選取送到另一邊；需要分割畫面。 */
  async function transferToOtherPane(mode: "copy" | "move") {
    const tab = tabs.activeTab;
    const other = tab ? tabs.otherPaneId(tab) : null;
    if (!tab || !other) {
      ui.showNotice("需要分割畫面才能送到另一邊");
      return;
    }
    await transfer(tab.activePaneId, other, mode);
  }

  /**
   * 就地重新命名單一項目。
   *
   * 實際改名交給 Windows shell：同名衝突、權限不足由系統出面處理，成功後也能在檔案總管
   * 按 Ctrl+Z 復原。成功時把清單重新載入並選取新名字，同時讓「剪下中」的標記與開著的
   * 檢視器一起改指向新路徑。回傳 false 代表使用者取消或失敗。
   */
  async function renameEntry(paneId: PaneId, path: string, newName: string): Promise<boolean> {
    if (busy.value) {
      return false;
    }
    const pane = explorer.meta(paneId);
    const parent = parentOf(path) ?? pane?.currentPath ?? "";
    if (!pane || !parent) {
      return false;
    }
    const newPath = joinPath(parent, newName);

    try {
      busy.value = true;
      const completed = await api.renameItem(path, newName);
      if (!completed) {
        // 使用者取消（例如同名衝突時按取消）：維持原名，不需要提示。
        return false;
      }

      const oldKey = normalizeKey(path);
      cutKeys.value = cutKeys.value.map((key) => (key === oldKey ? normalizeKey(newPath) : key));
      await viewer.retarget(path, newPath);

      // 只有在同一個資料夾才重讀；其他位置的窗格交給目錄監控的增量更新接手。
      if (samePath(parent, pane.currentPath)) {
        await explorer.refresh(paneId);
        const list = explorer.visibleRef(paneId).value;
        const index = list.findIndex((item) => samePath(item.path, newPath));
        // 用清單裡的實際路徑選取：後端回報的路徑大小寫可能與列舉結果不同。
        explorer.select(paneId, index >= 0 ? list[index].path : newPath, "replace");
      }

      ui.showNotice(`已重新命名為「${newName}」`);
      return true;
    } catch (cause) {
      report(cause);
      return false;
    } finally {
      busy.value = false;
    }
  }

  return {
    cutKeys,
    busy,
    isCut,
    selectionOf,
    put,
    copySelection,
    cutSelection,
    paste,
    transfer,
    transferToOtherPane,
    removePaths,
    renameEntry,
    refreshPanes,
  };
});
