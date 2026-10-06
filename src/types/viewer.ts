import type { AppErrorView } from "@/services/errors";

/** 檢視器支援的內容種類。 */
export type ViewerKind = "markdown" | "html" | "image" | "text";

/**
 * HTML 的顯示模式：`preview` 是靜態預覽（不執行 JavaScript），`source` 是原始碼。
 * 其他種類固定是 `preview`，切換鈕也只對 HTML 出現。
 */
export type ViewerMode = "preview" | "source";

/** 後端 `read_viewer_file` 透過 Tauri Channel 推送的事件。 */
export type ViewerStreamEvent =
  | {
      type: "start";
      path: string;
      name: string;
      size: number;
      modifiedMs: number | null;
      /** 文字檔實際使用的編碼（例如 `UTF-8`、`Big5`）。 */
      encoding: string | null;
      /** 圖片的 MIME 類型（例如 `image/png`）。 */
      mime: string | null;
    }
  | { type: "chunk"; text: string | null; base64: string | null }
  | { type: "done" };

export type ViewerStatus = "loading" | "ready" | "error";

/** 一個窗格目前的檢視器狀態；沒有這個鍵就代表該窗格在檔案清單模式。 */
export interface ViewerState {
  path: string;
  name: string;
  /** 內容種類；`null` 代表這個檔案沒有檢視器，窗格只顯示提示。 */
  kind: ViewerKind | null;
  /** 只有 HTML 會用到；開啟時一律從 `preview` 開始。 */
  mode: ViewerMode;
  status: ViewerStatus;
  error: AppErrorView | null;
  /** Markdown／HTML 原始碼或純文字內容。 */
  text: string;
  /** 文字檔的實際編碼；圖片為 null。 */
  encoding: string | null;
  /** 圖片的 blob URL；關閉或重載時必須撤銷。 */
  blobUrl: string | null;
  size: number;
  modifiedMs: number | null;
}
