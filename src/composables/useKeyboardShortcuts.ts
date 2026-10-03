import { onMounted, onUnmounted } from "vue";
import { useExplorerStore } from "@/stores/explorer";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";

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

    if (modifier) {
      switch (key) {
        case "t":
        case "T":
          event.preventDefault();
          tabs.newTab();
          return;
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
        void explorer.refresh(paneId);
        break;
      case "F6":
        event.preventDefault();
        cycleFocus();
        break;
      case "Backspace":
        event.preventDefault();
        void explorer.goUp(paneId);
        break;
      case "Enter":
        event.preventDefault();
        void explorer.activate(paneId, explorer.focusedEntry(paneId));
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
          ui.settingsOpen = false;
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

  onMounted(() => window.addEventListener("keydown", onKeydown));
  onUnmounted(() => window.removeEventListener("keydown", onKeydown));
}
