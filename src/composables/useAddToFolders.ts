import { useFoldersStore, TREE_ROOT_CONTAINER } from "@/stores/folders";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import type { MenuItem } from "@/types/menu";
import { fileNameOf } from "@/utils/path";

/** 檔案清單右鍵選單裡「加入我的資料夾」的項目 id。 */
export const ADD_TO_FOLDERS_ID = "add-to-folders";

/**
 * 把檔案清單裡的資料夾加進左側「我的資料夾」。
 *
 * 選單分兩段：第一段只有「加入我的資料夾」，按下後若清單上有虛擬目錄，
 * 就接著列出每個虛擬目錄＋「第一層」讓使用者挑容器；沒有虛擬目錄時直接
 * 加進第一層，不必多開一層只有一個選項的選單。
 */
export function useAddToFolders() {
  const folders = useFoldersStore();
  const settings = useSettingsStore();
  const ui = useUiStore();

  /** 清單上已經有完全相同路徑的節點（含虛擬目錄裡的）就沒得加，停用灰掉。 */
  function item(path: string): MenuItem {
    return {
      id: ADD_TO_FOLDERS_ID,
      label: "加入我的資料夾",
      icon: "folder",
      separatorBefore: true,
      disabled: folders.hasFolderPath(path),
    };
  }

  /**
   * 把項目排進選單：資料夾列放在「開啟」那一組之後（也就是「建立新資料夾」
   * 之前），空白處沒有那組錨點，改放最後一段。
   */
  function place(items: MenuItem[], path: string, anchor: "afterOpen" | "end"): MenuItem[] {
    const next = [...items];
    const at = anchor === "afterOpen" ? next.findIndex((row) => row.id === "new-folder") : -1;
    next.splice(at >= 0 ? at : next.length, 0, item(path));
    return next;
  }

  /** 第二段：挑容器。虛擬目錄在上，第一層固定放最後。 */
  function containerItems(): MenuItem[] {
    const groups = folders.groupNodes().map((group) => ({
      id: `group:${group.id}`,
      label: group.label,
      icon: "folderStack" as const,
    }));
    return [...groups, { id: "root", label: "第一層", icon: "folder" as const }];
  }

  /** 清單上有虛擬目錄才需要第二段；沒有就直接進第一層。 */
  function needsContainerPick(): boolean {
    return folders.groupNodes().length > 0;
  }

  /** 由第二段的項目 id 回推容器 id；不是容器項目時回 `null`。 */
  function containerOf(id: string): string | null {
    if (id === "root") {
      return TREE_ROOT_CONTAINER;
    }
    return id.startsWith("group:") ? id.slice("group:".length) : null;
  }

  /**
   * 加進指定的容器，並把樹帶到看得見它的位置（空間一致性：東西從哪來，就在哪發光）。
   * 只動左側清單，不改變窗格目前的路徑。
   */
  async function add(path: string, containerId: string) {
    if (!path) {
      return;
    }
    if (!folders.addFolder(path, containerId)) {
      ui.showNotice("這個資料夾已經在清單裡了");
      return;
    }
    if (settings.treeCollapsed) {
      settings.toggleTree();
    }
    folders.selectByPath(path);
    await folders.reveal(path);
    ui.showNotice(`已將「${fileNameOf(path) || path}」加入我的資料夾`);
  }

  return { place, containerItems, needsContainerPick, containerOf, add };
}
