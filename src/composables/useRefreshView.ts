import { useExplorerStore } from "@/stores/explorer";
import { useFoldersStore } from "@/stores/folders";
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

  return function refreshView(paneId: PaneId): Promise<void> {
    return Promise.all([explorer.refresh(paneId), folders.refresh()]).then(() => undefined);
  };
}
