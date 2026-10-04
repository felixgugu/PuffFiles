import type { AppErrorView } from "@/services/errors";

/** 檢視器支援的內容種類。 */
export type ViewerKind = "markdown" | "image" | "text";

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
  kind: ViewerKind;
  status: ViewerStatus;
  error: AppErrorView | null;
  /** Markdown 原始碼或純文字內容。 */
  text: string;
  /** 文字檔的實際編碼；圖片為 null。 */
  encoding: string | null;
  /** 圖片的 blob URL；關閉或重載時必須撤銷。 */
  blobUrl: string | null;
  size: number;
  modifiedMs: number | null;
}
