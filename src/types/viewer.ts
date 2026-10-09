import type { AppErrorView } from "@/services/errors";
import type { PaneId } from "@/types/fs";
import type { PanelLayout } from "@/utils/viewerPanel";

/**
 * 目錄索引面板的一列（`viewer/OutlinePanel.vue` 的輸入）。
 *
 * Markdown 是 h1～h6，DOCX 是使用者自己加的書籤（層級固定 1）。面板只認這個形狀，
 * 所以兩個檢視器共用同一個浮動面板（位置、大小、收合與拖曳都只有一份實作）。
 */
export interface OutlineItem {
  id: string;
  text: string;
  /** 縮排層級（1 起算）。 */
  level: number;
  /** 位置對不回目前的文件（DOCX 書籤改過太多）：淡化顯示並在提示裡說明。 */
  stale?: boolean;
}

/** 檢視器支援的內容種類。 */
export type ViewerKind = "markdown" | "html" | "image" | "text" | "pdf" | "docx";

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

/**
 * 檢視器搜尋面板的狀態（每個窗格一份）。
 *
 * 住在檢視器狀態裡而不是面板元件內：面板元件會隨檢視器種類換來換去，
 * 但「在同一個窗格裡找東西」是這個窗格的事。開啟新文件時預設整份重置；
 * 只有「保留搜尋字串」勾選時才把搜尋條件帶到新文件（見 `stores/viewer.ts`）。
 */
export interface ViewerSearchState {
  open: boolean;
  query: string;
  /** 大小寫須相符。 */
  caseSensitive: boolean;
  /** 只比對完整字詞。 */
  wholeWord: boolean;
  /** 把搜尋字串當成 Regex。 */
  regex: boolean;
}

/**
 * 檢視器浮動面板的收合狀態與位置尺寸。
 *
 * 每個檢視器（也就是每份開啟的文件）各有一份，不寫進設定、也不跨文件沿用 ——
 * 換一份文件就回到預設值（展開、貼右上角、預設寬度與自適應高度）。
 */
export interface ViewerPanelState {
  collapsed: boolean;
  layout: PanelLayout;
}

/** 一個窗格目前的檢視器狀態；沒有這個鍵就代表該窗格在檔案清單模式。 */
export interface ViewerState {
  path: string;
  name: string;
  /**
   * 開啟這份內容的來源窗格（檔案清單所在的那一個）。
   *
   * 圖片檢視器的「上一張／下一張」跟著這份清單的順序跑；沒有來源（例如日後新增的
   * 其他入口）就是 `null`，按鈕整組不出現。檢視器所在的窗格本身沒有這份清單 ——
   * 它多半正在瀏覽別的資料夾。
   */
  sourcePaneId: PaneId | null;
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
  /**
   * PDF 的串流 token（自訂協定 `stream`）；其他種類為 `null`。
   *
   * 關閉、換檔與重新載入都要撤銷舊的，URL 才不會在不需要時仍然有效。
   */
  streamToken: string | null;
  /** PDF 的 iframe 來源；與 `streamToken` 同進退。 */
  streamUrl: string | null;
  /**
   * DOCX 的原始位元組（就是那個 ZIP 檔本身）；其他種類為 `null`。
   *
   * 分頁切換時窗格整塊卸載重掛，`DocxView` 要拿同一份位元組重新排版，所以它住在
   * store 而不是元件裡。docx-preview 只能吃整份資料（內部是 JSZip），沒有串流版本。
   */
  bytes: Uint8Array | null;
  size: number;
  modifiedMs: number | null;
  /**
   * 內容區最後的捲動位置（px）。
   *
   * 分頁切換時窗格整塊卸載重掛（`WorkspaceView` 只渲染焦點分頁），DOM 的
   * `scrollTop` 會跟著消失；記在這裡，切回分頁時才回得到原本讀到的地方。
   */
  scrollTop: number;
  /**
   * 內容是不是已經貼在最上面／最下面。
   *
   * 標頭的捲動鈕據此停用；由捲動容器自己回報（`composables/useViewerNavigation.ts`），
   * 內容還沒量到時兩者都是 `true`（先停用，量到再亮）。
   */
  atTop: boolean;
  atBottom: boolean;
  /** 搜尋面板的開關、字串與三個選項。 */
  search: ViewerSearchState;
  /** 目錄索引面板的收合與位置尺寸（只有 Markdown 會用到）。 */
  tocPanel: ViewerPanelState;
  /** 搜尋面板的收合與位置尺寸。 */
  searchPanel: ViewerPanelState;
}
