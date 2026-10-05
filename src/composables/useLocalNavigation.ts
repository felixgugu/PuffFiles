import { useExplorerStore } from "@/stores/explorer";
import { useUiStore } from "@/stores/ui";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import { fileNameOf, parentOf } from "@/utils/path";

/**
 * 檢視器裡的「相對連結」導覽。
 *
 * 行為固定：關掉檢視器、在該窗格導覽到目標所在的資料夾並選取它；目標是資料夾時
 * 再往下一層（需要先載入父層清單才知道它是什麼）。Markdown 檢視器與 HTML 預覽
 * 共用同一份，兩邊的連結行為才不會分岔。
 */
export function useLocalNavigation() {
  const explorer = useExplorerStore();
  const viewer = useViewerStore();
  const ui = useUiStore();

  async function openLocalTarget(paneId: PaneId, target: string): Promise<void> {
    const parent = parentOf(target);
    viewer.close(paneId);

    if (!parent) {
      await explorer.navigate(paneId, target);
      return;
    }

    await explorer.navigate(paneId, parent);
    const entry = explorer.visibleRef(paneId).value.find((item) => item.path === target);
    if (!entry) {
      ui.showNotice(`找不到連結目標：${fileNameOf(target) || target}`);
      return;
    }
    if (entry.isDir) {
      await explorer.navigate(paneId, entry.path);
      return;
    }
    explorer.select(paneId, entry.path);
  }

  return { openLocalTarget };
}
