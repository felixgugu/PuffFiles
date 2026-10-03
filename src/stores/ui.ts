import { defineStore } from "pinia";
import { ref } from "vue";

export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

export interface PromptOptions {
  title: string;
  label?: string;
  placeholder?: string;
  /** 預填值。 */
  value?: string;
  confirmText?: string;
  /** 聚焦時只選取到第幾個字（例如檔名只選主檔名、不選副檔名）。 */
  selectTo?: number;
}

/**
 * 短生命週期的 UI 狀態：通知、跨元件的焦點請求、浮層開關。
 *
 * 主題與其他偏好屬於 `settings` store；這裡只放「用完即丟」的東西。
 */
export const useUiStore = defineStore("ui", () => {
  const notice = ref<string | null>(null);
  const noticeAction = ref<NoticeAction | null>(null);
  const searchFocusRequest = ref(0);
  const pathEditRequest = ref(0);
  const settingsOpen = ref(false);
  const historyOpen = ref(false);
  const confirmState = ref<ConfirmOptions | null>(null);
  const promptState = ref<PromptOptions | null>(null);

  let confirmResolver: ((value: boolean) => void) | null = null;
  let promptResolver: ((value: string | null) => void) | null = null;

  /** 開一個確認對話框並等待使用者回答；同時只會有一個。 */
  function confirm(options: ConfirmOptions): Promise<boolean> {
    confirmResolver?.(false);
    confirmState.value = options;
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function resolveConfirm(value: boolean) {
    confirmState.value = null;
    confirmResolver?.(value);
    confirmResolver = null;
  }

  /** 開一個輸入對話框並等待結果；取消回傳 null。同時只會有一個。 */
  function prompt(options: PromptOptions): Promise<string | null> {
    promptResolver?.(null);
    promptState.value = options;
    return new Promise((resolve) => {
      promptResolver = resolve;
    });
  }

  function resolvePrompt(value: string | null) {
    promptState.value = null;
    promptResolver?.(value);
    promptResolver = null;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  function showNotice(message: string, action?: NoticeAction, duration = 2600) {
    notice.value = message;
    noticeAction.value = action ?? null;
    clearTimeout(timer);
    timer = setTimeout(dismissNotice, duration);
  }

  function dismissNotice() {
    clearTimeout(timer);
    notice.value = null;
    noticeAction.value = null;
  }

  function requestSearchFocus() {
    searchFocusRequest.value += 1;
  }

  function requestPathEdit() {
    pathEditRequest.value += 1;
  }

  return {
    notice,
    noticeAction,
    searchFocusRequest,
    pathEditRequest,
    settingsOpen,
    historyOpen,
    confirmState,
    confirm,
    resolveConfirm,
    promptState,
    prompt,
    resolvePrompt,
    showNotice,
    dismissNotice,
    requestSearchFocus,
    requestPathEdit,
  };
});

// setup store 內有非響應式快取（項目陣列、AbortController、子節點快取），
// 熱更新無法安全接手，整頁重載才能保證狀態一致；工作階段會從 localStorage 還原。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
