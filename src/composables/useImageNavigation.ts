import { useExplorerStore } from "@/stores/explorer";
import { useViewerStore } from "@/stores/viewer";
import type { FileEntry, PaneId } from "@/types/fs";
import { parentOf, samePath } from "@/utils/path";
import { imageNeighbor, viewerKindOf } from "@/utils/viewer";

/**
 * 圖片檢視器的「上一張／下一張」。
 *
 * 順序固定跟著**開啟這張圖片的來源檔案清單** —— 使用者當下看到的那一份，
 * 含它的排序、搜尋關鍵字與隱藏項目設定，所以按鈕與 `Space` 預覽看到的是同一個順序。
 *
 * 檢視器所在的窗格本身沒有這份清單（它多半正在瀏覽別的資料夾，或根本沒有載入），
 * 因此序列一律問 `ViewerState.sourcePaneId`。來源窗格已經被關掉、或使用者之後把它
 * 導覽走了（目前資料夾不等於圖片的資料夾）時視為「沒有序列」：按鈕不出現，不猜測。
 */
export function useImageNavigation() {
  const explorer = useExplorerStore();
  const viewer = useViewerStore();

  /** 這個窗格的圖片序列；沒有序列時回空陣列。 */
  function siblings(paneId: PaneId): FileEntry[] {
    const state = viewer.of(paneId);
    const source = state?.sourcePaneId;
    if (!state || state.kind !== "image" || !source) {
      return [];
    }
    const folder = parentOf(state.path);
    if (!folder || !samePath(explorer.meta(source)?.currentPath ?? "", folder)) {
      return [];
    }
    return explorer.visibleRef(source).value.filter((entry) => viewerKindOf(entry) === "image");
  }

  /** 目前圖片的前／後一張；兩端與沒有序列時都是 `null`。 */
  function neighbor(paneId: PaneId, delta: 1 | -1): FileEntry | null {
    const state = viewer.of(paneId);
    return state ? imageNeighbor(siblings(paneId), state.path, delta) : null;
  }

  /** 這個方向切不切得動（按鈕的顯示與停用都問這裡）。 */
  function canStep(paneId: PaneId, delta: 1 | -1): boolean {
    return neighbor(paneId, delta) !== null;
  }

  /**
   * 換到前／後一張。
   *
   * 先把來源清單的選取與焦點移到新圖片（清單自己的 watcher 會把它捲進可視範圍），
   * 再把檢視器疊到新路徑上 —— 兩邊永遠指著同一張，`Space` 的「智慧前進」與關閉
   * 檢視器後回到的位置才一致。
   */
  function step(paneId: PaneId, delta: 1 | -1): void {
    const state = viewer.of(paneId);
    const source = state?.sourcePaneId;
    const target = neighbor(paneId, delta);
    if (!state || !source || !target) {
      return;
    }
    explorer.select(source, target.path, "replace");
    void viewer.open(paneId, target.path, source);
  }

  return { neighbor, canStep, step };
}
