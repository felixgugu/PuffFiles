import { onMounted, onUnmounted } from "vue";
import { useExplorerStore } from "@/stores/explorer";
import { useClipboardStore } from "@/stores/clipboard";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import { useToolEditorStore } from "@/stores/toolEditor";
import { useUiStore } from "@/stores/ui";
import { useViewerStore } from "@/stores/viewer";
import { useRefreshView } from "@/composables/useRefreshView";
import { usePathMenu } from "@/composables/usePathMenu";
import type { PaneId } from "@/types/fs";

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
  const viewer = useViewerStore();

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
          ["w", "W", "\\", "|", "Tab", "l", "L"].includes(key) ||
          ((key === "n" || key === "N") && !shiftKey);
        if (!allowed) {
          return;
        }
      } else if (key === "F5") {
        event.preventDefault();
        void viewer.reload(paneId);
        return;
      } else if (key === "Escape" && !ui.settingsOpen && !ui.historyOpen) {
        event.preventDefault();
        viewer.close(paneId);
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
          if (shiftKey) {
            void clipboard.transferToOtherPane("copy");
          } else {
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
          if (!shiftKey) {
            break;
          }
          event.preventDefault();
          void clipboard.transferToOtherPane("move");
          return;
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
      case "Delete":
        event.preventDefault();
        void clipboard.removePaths(clipboard.selectionOf(paneId));
        break;
      case "Backspace":
        event.preventDefault();
        void explorer.goUp(paneId);
        break;
      case "Enter":
        event.preventDefault();
        void explorer.activate(paneId, explorer.focusedEntry(paneId));
        break;
      case " ":
        event.preventDefault();
        openViewerPane(paneId);
        break;
      case "ArrowDown":
        event.preventDefault();
        explorer.moveFocus(paneId, 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (altKey) {
          void explorer.goUp(paneId);
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
   * Space：把焦點列的項目開到檢視器窗格。
   *
   * 走的是跟右鍵選單「在新窗格開啟／在○窗格開啟」同一條 `open-pane` 路徑，
   * 所以不支援的檔案類型會直接顯示提示，不會有任何副作用。
   */
  function openViewerPane(paneId: PaneId) {
    const entry = explorer.focusedEntry(paneId);
    if (!entry) {
      return;
    }
    if (entry.isDir) {
      ui.showNotice("檢視器只能開啟檔案");
      return;
    }
    void pathMenu.run("open-pane", {
      paneId,
      target: { path: entry.path, isDir: false },
      targets: [{ path: entry.path, isDir: false }],
    });
  }


  onMounted(() => window.addEventListener("keydown", onKeydown));
  onUnmounted(() => window.removeEventListener("keydown", onKeydown));
}
