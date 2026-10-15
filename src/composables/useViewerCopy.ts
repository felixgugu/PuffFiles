import { copyText } from "@/services/clipboard";
import { useUiStore } from "@/stores/ui";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import type { ViewerKind, ViewerMode } from "@/types/viewer";
import { viewerCopyLabel } from "@/utils/viewer";
import { visibleTextOf } from "@/utils/visibleText";

/**
 * 檢視器的「複製全部內容」。
 *
 * 一半的內容（Markdown、純文字、HTML 原始碼）就在 `ViewerState.text` 裡，另一半
 * （HTML 預覽、排版後的 DOCX）只有畫面 —— 前者直接讀 store，後者由內容元件註冊
 * 一個取值函數。註冊表刻意是模組層級的非響應式狀態：DOM 元素不該被追蹤，
 * 而且標頭與內容沒有共同的父元件可以傳 ref（與 `useViewerNavigation.ts` 的
 * 捲動容器同一套路）。
 *
 * 回 `null` 代表「這個窗格的可見文字現在拿不到」（iframe 還沒載入、DOCX 還在
 * 重排）：呼叫端會提示稍後再試，而不是把空字串或半份內容寫進剪貼簿。
 */
const providers = new Map<PaneId, () => string | null>();

export function registerViewerTextProvider(
  paneId: PaneId,
  provider: (() => string | null) | null,
): void {
  if (provider) {
    providers.set(paneId, provider);
  } else {
    providers.delete(paneId);
  }
}

/** 這個檢視器的內容是不是只有 DOM 有（不能只讀 store）。 */
function needsDom(kind: ViewerKind | null, mode: ViewerMode): boolean {
  return kind === "docx" || (kind === "html" && mode !== "source");
}

/**
 * 把這個窗格目前顯示的內容整份複製到剪貼簿，並跳一則通知。
 *
 * 不跳確認框：這是唯讀動作，且與 Mermaid 的「複製原始碼」一致。
 */
export async function copyViewerContent(paneId: PaneId): Promise<void> {
  const viewer = useViewerStore();
  const ui = useUiStore();
  const state = viewer.of(paneId);
  if (!state || state.status !== "ready") {
    return;
  }
  const label = viewerCopyLabel(state.kind, state.mode);
  if (!label) {
    return;
  }

  let text: string | null;
  if (needsDom(state.kind, state.mode)) {
    const provider = providers.get(paneId);
    text = provider ? provider() : null;
  } else {
    text = state.text;
  }

  if (text === null) {
    ui.showNotice("內容還在準備中，請稍後再試");
    return;
  }
  if (!text.trim()) {
    ui.showNotice("這個檔案沒有可複製的內容");
    return;
  }
  ui.showNotice((await copyText(text)) ? label.done : "複製失敗");
}

/** 給內容元件用的便利包：把「可見文字」做成取值函數。 */
export function visibleTextProvider(element: () => HTMLElement | null): () => string | null {
  return () => {
    const root = element();
    return root ? visibleTextOf(root) : null;
  };
}
