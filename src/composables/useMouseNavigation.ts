import { onMounted, onUnmounted } from "vue";
import { useExplorerStore } from "@/stores/explorer";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";

/** DOM 的 `MouseEvent.button`：3＝後側鍵（上一頁）、4＝前側鍵（下一頁）。 */
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * 滑鼠側鍵導覽。
 *
 * WebView2 會把滑鼠後側鍵當成瀏覽器的「上一頁」，但 PuffFile 的歷史住在 explorer store，
 * 不是 WebView 的頁面歷史。這裡攔下預設動作，讓後側鍵走和 Alt+← 完全相同的那條路徑；
 * 前側鍵只阻止 WebView 預設行為，不另外提供下一頁。
 */
export function useMouseNavigation() {
  const explorer = useExplorerStore();
  const tabs = useTabsStore();
  const ui = useUiStore();

  function onMouseDown(event: MouseEvent) {
    if (event.button !== MOUSE_BACK && event.button !== MOUSE_FORWARD) {
      return;
    }
    // 側鍵在 Chromium 會以 mousedown／mouseup 送到頁面；先在 capture 階段攔下。
    event.preventDefault();
    if (event.button !== MOUSE_BACK) {
      return;
    }
    // 對話框、設定頁或正在輸入時，側鍵不該動到看不見的背景清單。
    if (
      ui.choiceState ||
      ui.confirmState ||
      ui.promptState ||
      ui.settingsOpen ||
      isTypingTarget(event.target) ||
      isTypingTarget(document.activeElement)
    ) {
      return;
    }
    const paneId = tabs.activePaneId;
    if (paneId) {
      void explorer.goBack(paneId);
    }
  }

  // capture：先於可能自行攔截非主鍵的元件處理，也確保 WebView 沒機會執行自己的上一頁。
  onMounted(() => {
    window.addEventListener("mousedown", onMouseDown, true);
  });
  onUnmounted(() => {
    window.removeEventListener("mousedown", onMouseDown, true);
  });
}
