import { defineStore } from "pinia";
import { ref } from "vue";
import * as api from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { useExplorerStore } from "@/stores/explorer";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import { fileNameOf, joinPath, normalizeKey, parentOf, samePath } from "@/utils/path";
import { paneSlotLabel } from "@/utils/layout";

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

  /** 被刪項目中最上面那一項在可見清單的索引；都找不到（被搜尋篩掉）時回 null。 */
  function landingIndex(paneId: PaneId, targets: string[]): number | null {
    const visible = explorer.visibleRef(paneId).value;
    let landing: number | null = null;
    for (const path of targets) {
      const index = visible.findIndex((item) => samePath(item.path, path));
      if (index >= 0 && (landing === null || index < landing)) {
        landing = index;
      }
    }
    return landing;
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

  /**
   * 貼上（來源可以是檔案總管）；`into` 省略時貼到該窗格目前的資料夾。
   *
   * 貼上的是同一個資料夾裡的項目時，shell 會直接產生「- 複製」的新名字（見
   * `core/shell.rs`）。那種情況只會有一個新項目，就在貼完後直接讓它進入就地編輯，
   * 省掉「先貼上、再自己按 F2」這一步；同時貼多個時不猜要改哪一個，維持原樣。
   */
  async function paste(paneId: PaneId, into?: string) {
    if (busy.value) {
      return;
    }
    const destination = into ?? explorer.meta(paneId)?.currentPath;
    if (!destination) {
      return;
    }
    // 就地編輯要等檔案操作結束（`busy` 放掉）才開始，所以先記下來、最後再送出去。
    let renamed: string | null = null;
    try {
      const clip = await api.clipboardFiles();
      if (!clip.paths.length) {
        ui.showNotice("剪貼簿裡沒有檔案");
        return;
      }

      busy.value = true;
      const outcome: api.CopyOutcome = clip.cut
        ? { completed: await api.moveItems(clip.paths, destination), renamed: [] }
        : await api.copyItems(clip.paths, destination);

      if (!outcome.completed) {
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
      // 剛好一個「- 複製」：清單已經重讀完了，直接把那一列交給就地編輯。
      renamed = outcome.renamed.length === 1 ? outcome.renamed[0] : null;
    } catch (cause) {
      report(cause);
    } finally {
      busy.value = false;
    }
    if (renamed) {
      ui.requestRenameAt(paneId, renamed);
    }
  }

  /**
   * 送到另一窗格前的確認訊息：把來源與目標寫清楚，避免複製／搬移的方向搞錯。
   * 窗格位置標籤沿用 `paneSlotLabel()`（左／右或上／下），與狀態列、路徑列一致。
   */
  function transferMessage(
    from: PaneId,
    to: PaneId,
    sources: string[],
    destination: string,
  ): string {
    const tab = tabs.activeTab;
    const slot = (id: PaneId) => {
      const label = tab ? paneSlotLabel(tab, id) : "";
      return label ? `${label}窗格` : "焦點窗格";
    };
    const sourceFolder = explorer.meta(from)?.currentPath || (parentOf(sources[0]) ?? "");
    const names = sources.map(fileNameOf);
    const listed =
      names.length <= 5 ? names.join("、") : `${names.slice(0, 5).join("、")} 等 ${names.length} 個`;
    return [
      `來源（${slot(from)}）：${sourceFolder}`,
      `目標（${slot(to)}）：${destination}`,
      `項目（${sources.length} 個）：${listed}`,
    ].join("\n");
  }

  /** 直接在兩個窗格之間複製或搬移，不經過剪貼簿。執行前先請使用者確認方向。 */
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

    if (
      !(await ui.confirm({
        title: mode === "copy" ? "複製到另一窗格？" : "移動到另一窗格？",
        message: transferMessage(from, to, sources, destination),
        confirmText: mode === "copy" ? "複製" : "移動",
      }))
    ) {
      return;
    }

    try {
      busy.value = true;
      // 「複製到另一窗格」就算兩個窗格剛好開在同一個資料夾，也只做檔案操作、
      // 不接手就地編輯：那是使用者自己按了確認的明確動作。
      const completed =
        mode === "copy"
          ? (await api.copyItems(sources, destination)).completed
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

  /**
   * 刪除（預設進資源回收筒，確認與否由 Windows 決定）。
   *
   * 刪完會重讀清單，而重讀本身會清掉選取、把焦點歸零，於是焦點框跳回第一列；
   * 所以刪除前先記下「被刪項目中最上面那一項」在可見清單的位置，重讀後把選取放回
   * 同一個位置 —— 由後面那一列遞補（與檔案總管一致），被刪的是最後一列時就停在新的
   * 最後一列。清單變空、或窗格已經換了資料夾就不選。
   */
  async function removePaths(targets: string[], paneId: PaneId) {
    if (busy.value) {
      return;
    }
    if (!targets.length) {
      ui.showNotice("請先選取項目");
      return;
    }

    // 落點一定要在刪除前算：刪完之後這些路徑已經不在清單裡了。
    const pane = explorer.meta(paneId);
    const folder = pane?.currentPath ?? "";
    const landing = pane ? landingIndex(paneId, targets) : null;

    try {
      busy.value = true;
      const completed = await api.deleteItems(targets);
      if (!completed) {
        ui.showNotice("操作已取消");
        return;
      }
      ui.showNotice(`已刪除 ${targets.length} 個項目`);
      await refreshPanes();

      // 重讀後同一個位置由後面那一列遞補；超出新的長度就取最後一列。
      // 刪除期間換了資料夾（或窗格已經不在）就不套用，免得在新的地方亂選。
      const after = explorer.meta(paneId);
      if (after && after.currentPath === folder && landing !== null) {
        const list = explorer.visibleRef(paneId).value;
        if (list.length > 0) {
          explorer.select(paneId, list[Math.min(landing, list.length - 1)].path, "replace");
        }
      }
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
