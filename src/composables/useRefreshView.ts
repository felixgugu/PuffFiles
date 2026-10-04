import { useExplorerStore } from "@/stores/explorer";
import { useFoldersStore } from "@/stores/folders";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";

/**
 * 「重新整理」＝把畫面上看得到的東西重新讀一遍。
 *
 * 清單與資料夾樹各有自己的快取，所以兩個都要更新 —— 只重讀清單的話，
 * 樹還是會停在你上次展開時的內容。
 */
export function useRefreshView() {
  const explorer = useExplorerStore();
  const folders = useFoldersStore();
  const viewer = useViewerStore();

  return function refreshView(paneId: PaneId): Promise<void> {
    // 檢視器窗格的「重新整理」是重新讀這個檔案，不是重讀底層資料夾。
    if (viewer.isOpen(paneId)) {
      return viewer.reload(paneId);
    }
    return Promise.all([explorer.refresh(paneId), folders.refresh()]).then(() => undefined);
  };
}
