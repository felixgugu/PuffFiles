import { onMounted, onUnmounted } from "vue";
import { useExplorerStore } from "@/stores/explorer";
import { useClipboardStore } from "@/stores/clipboard";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import { useToolEditorStore } from "@/stores/toolEditor";
import { useUiStore } from "@/stores/ui";
import { useViewerStore } from "@/stores/viewer";
import { useImageNavigation } from "@/composables/useImageNavigation";
import { useRefreshView } from "@/composables/useRefreshView";
import { usePathMenu } from "@/composables/usePathMenu";
import { useSyncedNavigation } from "@/composables/useSyncedNavigation";
import type { PaneId } from "@/types/fs";
import { samePath } from "@/utils/path";

/**
 * 全域快速鍵。
 *
 * 沿用 Windows 檔案總管（Backspace、Alt+←/→、F5、F6）與 VS Code（Ctrl+\\、Ctrl+W）
 * 的肌肉記憶 —— 熟悉感是免費的可用性。
 */
export function useKeyboardShortcuts() {
  const explorer = useExplorerStore();
  const tabs = useTabsStore();
  const ui = useUiStore();
  const settings = useSettingsStore();
  const toolEditor = useToolEditorStore();
  const refreshView = useRefreshView();
  const clipboard = useClipboardStore();
  const pathMenu = usePathMenu();
  const syncedNav = useSyncedNavigation();
  const viewer = useViewerStore();
  const imageNav = useImageNavigation();

  function isTypingTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  function onKeydown(event: KeyboardEvent) {
    const { key, altKey, ctrlKey, metaKey, shiftKey } = event;
    const modifier = ctrlKey || metaKey;

    // 多選項對話框開著時只處理它自己的按鍵（Esc＝取消）。
    if (ui.choiceState) {
      if (key === "Escape") {
        event.preventDefault();
        ui.resolveChoice(null);
      }
      return;
    }

    // 確認對話框開著時只處理它自己的按鍵。
    if (ui.confirmState) {
      if (key === "Escape") {
        event.preventDefault();
        ui.resolveConfirm(false);
      } else if (key === "Enter") {
        event.preventDefault();
        ui.resolveConfirm(true);
      }
      return;
    }

    // 輸入對話框開著時，Enter／Esc 由對話框自己處理。
    if (ui.promptState) {
      return;
    }

    // 設定頁開著時只留下 Esc；其他快速鍵不該在看不到畫面的情況下動到瀏覽狀態。
    if (ui.settingsOpen && key !== "Escape") {
      return;
    }

    // 分頁切換即使在輸入框裡也要生效。
    if (modifier && key === "Tab") {
      event.preventDefault();
      tabs.cycleTab(shiftKey ? -1 : 1);
      return;
    }

    if (isTypingTarget(event.target)) {
      return;
    }

    const paneId = tabs.activePaneId;

    /*
     * 檢視器窗格聚焦時，清單類的快速鍵（選取、剪貼、刪除）一律不攔截 ——
     * 那些動作在畫面上看不到，攔下來只會誤傷文字選取與 Ctrl+C 複製。
     * 分頁／版面層級的操作（Ctrl+W、Ctrl+Tab、Ctrl+\…）維持可用。
     */
    if (viewer.isOpen(paneId)) {
      if (modifier) {
        // 只放行分頁／版面層級的操作；Ctrl+Shift+N（建立新資料夾）是清單操作，不在此列。
        const allowed =
          ["w", "W", "\\", "|", "Tab", "l", "L", "f", "F"].includes(key) ||
          ((key === "n" || key === "N") && !shiftKey);
        if (!allowed) {
          return;
        }
        // Ctrl+F 在檢視器裡是「搜尋檢視器內容」，不是清單的搜尋目前資料夾。
        if (key === "f" || key === "F") {
          event.preventDefault();
          viewer.toggleSearch(paneId);
          return;
        }
      } else if (key === "F5") {
        event.preventDefault();
        void viewer.reload(paneId);
        return;
      } else if (key === "Escape" && !ui.settingsOpen && !ui.historyOpen) {
        event.preventDefault();
        // 搜尋面板開著時 Esc 先關面板，再按一次才關檢視器。
        if (viewer.of(paneId)?.search.open) {
          viewer.closeSearch(paneId);
        } else {
          viewer.close(paneId);
        }
        return;
      } else if ((key === "ArrowLeft" || key === "ArrowRight") && !altKey) {
        // 圖片檢視器：←／→＝上一張／下一張（順序見 `useImageNavigation`）。
        // 其他種類維持原本「方向鍵在檢視器裡不做清單操作」的行為。
        if (viewer.of(paneId)?.kind === "image") {
          event.preventDefault();
          imageNav.step(paneId, key === "ArrowLeft" ? -1 : 1);
        }
        return;
      } else if (key !== "F6" && key !== "Escape") {
        // Escape 在有浮層時往下走，讓設定頁／瀏覽紀錄先關閉。
        return;
      }
    }

    if (modifier) {
      switch (key) {
        case "w":
        case "W":
          event.preventDefault();
          if (shiftKey) {
            tabs.closePane(paneId);
          } else {
            tabs.closeTab(tabs.activeTabId);
          }
          return;
        case "\\":
          event.preventDefault();
          tabs.split("row");
          return;
        case "|":
          event.preventDefault();
          tabs.split("column");
          return;
        case "a":
        case "A":
          event.preventDefault();
          explorer.selectAll(paneId);
          return;
        case "c":
        case "C":
          event.preventDefault();
          // Ctrl+Shift+C 過去是「複製到另一窗格」，與 Ctrl+C 太容易誤觸；
          // 這個動作只保留在右鍵選單手動執行。
          if (!shiftKey) {
            void clipboard.copySelection(paneId);
          }
          return;
        case "x":
        case "X":
          event.preventDefault();
          void clipboard.cutSelection(paneId);
          return;
        case "v":
        case "V":
          event.preventDefault();
          void clipboard.paste(paneId);
          return;
        case "m":
        case "M":
          // Ctrl+Shift+M 過去是「移動到另一窗格」，同樣容易誤觸；
          // 這個動作只保留在右鍵選單手動執行，不再綁定快速鍵。
          break;
        case "n":
        case "N":
          event.preventDefault();
          if (shiftKey) {
            void pathMenu.run("new-folder", {
              paneId,
              target: { path: explorer.meta(paneId)?.currentPath ?? "", isDir: true },
              targets: [],
            });
          } else {
            tabs.newTab();
          }
          return;
        case "f":
        case "F":
          event.preventDefault();
          ui.requestSearchFocus();
          return;
        case "l":
        case "L":
          event.preventDefault();
          ui.requestPathEdit();
          return;
        default:
          break;
      }

      if (/^[1-9]$/.test(key)) {
        event.preventDefault();
        const index = key === "9" ? tabs.tabs.length - 1 : Number(key) - 1;
        tabs.activateTabAt(index);
        return;
      }
      return;
    }

    switch (key) {
      case "F5":
        event.preventDefault();
        void refreshView(paneId);
        break;
      case "F6":
        event.preventDefault();
        cycleFocus();
        break;
      case "F2":
        event.preventDefault();
        ui.requestRename();
        break;
      case "Delete":
        event.preventDefault();
        void clipboard.removePaths(clipboard.selectionOf(paneId), paneId);
        break;
      case "Backspace":
        event.preventDefault();
        void syncedNav.up(paneId);
        break;
      case "Enter":
        event.preventDefault();
        void syncedNav.open(paneId, explorer.focusedEntry(paneId));
        break;
      case " ":
        event.preventDefault();
        openFocusedInPane(paneId);
        break;
      case "ArrowDown":
        event.preventDefault();
        explorer.moveFocus(paneId, 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (altKey) {
          void syncedNav.up(paneId);
        } else {
          explorer.moveFocus(paneId, -1);
        }
        break;
      case "ArrowLeft":
        if (!altKey) {
          break;
        }
        event.preventDefault();
        void explorer.goBack(paneId);
        break;
      case "ArrowRight":
        if (!altKey) {
          break;
        }
        event.preventDefault();
        void explorer.goForward(paneId);
        break;
      case "Home":
        event.preventDefault();
        explorer.focusAt(paneId, 0);
        break;
      case "End":
        event.preventDefault();
        explorer.focusAt(paneId, Number.MAX_SAFE_INTEGER);
        break;
      case "Escape":
        if (ui.settingsOpen) {
          // 關設定前先問過「外部工具」的未儲存草稿。
          void toolEditor.leaveSection().then((canLeave) => {
            if (canLeave) {
              ui.settingsOpen = false;
            }
          });
        } else if (ui.historyOpen) {
          ui.historyOpen = false;
        } else {
          explorer.clearSelection(paneId);
        }
        break;
      default:
        break;
    }
  }

  /** F6：在窗格之間移動焦點；只有一個窗格時改為切換左側資料夾清單。 */
  function cycleFocus() {
    const tab = tabs.activeTab;
    if (!tab) {
      return;
    }
    if (tab.paneIds.length > 1) {
      const index = tab.paneIds.indexOf(tab.activePaneId);
      tab.activePaneId = tab.paneIds[(index + 1) % tab.paneIds.length];
      return;
    }
    settings.toggleTree();
  }

  /**
   * Space：把焦點列的項目顯示到另一窗格，焦點留在檔案清單。
   *
   * 資料夾＝在另一窗格開它的檔案清單；檔案＝開檢視器（沒有檢視器的類型顯示
   * 「這個檔案類型還沒有檢視器」的提示，仍然佔用該窗格）。全部都走右鍵選單
   * 「在新窗格開啟／在○窗格開啟」同一條 `open-pane` 路徑，差別只在這裡帶入
   * `keepFocus` —— 焦點留在原清單，才能用方向鍵＋`Space` 連續掃描同一個資料夾。
   *
   * **智慧前進**：焦點項目若已經顯示在另一窗格（檔案在檢視器、或資料夾正是另一
   * 窗格目前瀏覽的位置），按 `Space` 的意圖是「看下一個」，所以前進到清單的下一列
   * （不分類型，資料夾與沒有檢視器的檔案都算），焦點與選取一起移動。已經是最後
   * 一列時停在原地，不做任何事。
   */
  function openFocusedInPane(paneId: PaneId) {
    const entry = explorer.focusedEntry(paneId);
    if (!entry) {
      return;
    }

    let target = entry;
    if (isDisplayedInNeighbor(paneId, entry)) {
      const list = explorer.visibleRef(paneId).value;
      const current = list.findIndex((item) => item.path === entry.path);
      const next = current + 1;
      if (current < 0 || next >= list.length) {
        return;
      }
      target = list[next];
      // 焦點與選取一起移動：畫面上「正在看哪一個」只會有一種說法，
      // 而且會沿用清單自己的 watcher 把新的一列捲進可視範圍。
      explorer.select(paneId, target.path, "replace");
    }

    void pathMenu.run(
      "open-pane",
      {
        paneId,
        target: { path: target.path, isDir: target.isDir },
        targets: [{ path: target.path, isDir: target.isDir }],
      },
      { keepFocus: true },
    );
  }

  /**
   * 焦點項目是不是已經顯示在「另一個窗格」。
   *
   * 每分頁最多兩個窗格，所以相對焦點窗格的那一個就是鄰居；未分割時沒有鄰居。
   * 兩種顯示方式都要認得：
   * - 檔案：鄰居的檢視器正開著它（含沒有檢視器的提示狀態）。
   * - 資料夾：鄰居正在瀏覽它，而且沒有被檢視器蓋住。
   * 檢視器還在 loading 也算已開啟 —— 連續按 `Space` 才不會把上一鍵的結果漏掉。
   */
  function isDisplayedInNeighbor(
    paneId: PaneId,
    entry: { path: string; isDir: boolean },
  ): boolean {
    const tab = tabs.activeTab;
    if (!tab || !tab.paneIds.includes(paneId)) {
      return false;
    }
    const neighbor = tab.paneIds.find((id) => id !== paneId) ?? null;
    if (!neighbor) {
      return false;
    }
    const state = viewer.of(neighbor);
    if (state) {
      return samePath(state.path, entry.path);
    }
    return entry.isDir && samePath(explorer.meta(neighbor)?.currentPath ?? "", entry.path);
  }

  onMounted(() => window.addEventListener("keydown", onKeydown));
  onUnmounted(() => window.removeEventListener("keydown", onKeydown));
}
