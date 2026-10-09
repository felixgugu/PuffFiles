import type { FileEntry } from "@/types/fs";
import type { BookmarkKind } from "@/types/bookmarks";
import type { ViewerKind } from "@/types/viewer";
import { fileKindOf } from "@/utils/fileKind";
import { fileNameOf, samePath } from "@/utils/path";
import { MAX_SEARCH_TEXT } from "@/utils/textSearch";

/**
 * 可以交給圖片檢視器的副檔名。
 *
 * 刻意比 `fileKind.ts` 的「影像」窄：那份清單是給圖示與色系用的，
 * 這裡只列 WebView2 真的畫得出來的格式，免得使用者只看到破圖。
 */
export const VIEWER_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "gif",
  "bmp",
  "webp",
  "svg",
  "ico",
  "avif",
] as const;

const IMAGE_EXTENSIONS = new Set<string>(VIEWER_IMAGE_EXTENSIONS);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
/** HTML 走靜態預覽（`HtmlView`），不是純文字；`.htm` 在 `fileKind.ts` 也歸成程式碼。 */
const HTML_EXTENSIONS = new Set(["html", "htm"]);
/**
 * PDF 走自訂協定（`stream`）＋ WebView2 內建的 PDF viewer，不是純文字也不是圖片：
 * 後端只在使用者捲動時送出被請求的那一段（HTTP Range），內容不經過 base64／Blob。
 */
const PDF_EXTENSIONS = new Set(["pdf"]);
/**
 * DOCX 走 `docx-preview`：位元組經由 `stream` 自訂協定取回後在 DOM 裡排版。
 *
 * 只認 OOXML 的 Word 檔（`.docx`）與啟用巨集的版本（`.docm`，封裝完全相同，巨集
 * 不會被執行也不影響排版）；舊版 `.doc` 是 OLE 二進位、`.rtf`／`.odt` 也不是 ZIP，
 * 一律留給系統預設程式。
 */
const DOCX_EXTENSIONS = new Set(["docx", "docm"]);

/**
 * 這個項目能不能用檢視器打開；不能就回 `null`。
 *
 * Markdown 與 HTML 各成一類；其餘沿用 `fileKind.ts` 既有的分類 —— 被歸成
 * 「文字文件」或「程式碼」的一律當純文字看，所以不用另外維護第二份副檔名清單。
 */
export function viewerKindOf(entry: Pick<FileEntry, "isDir" | "extension">): ViewerKind | null {
  if (entry.isDir || !entry.extension) {
    return null;
  }
  const extension = entry.extension.toLocaleLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return "markdown";
  }
  if (HTML_EXTENSIONS.has(extension)) {
    return "html";
  }
  if (PDF_EXTENSIONS.has(extension)) {
    return "pdf";
  }
  if (DOCX_EXTENSIONS.has(extension)) {
    return "docx";
  }
  const kind = fileKindOf(entry);
  return kind === "text" || kind === "code" ? "text" : null;
}

/** 只有路徑時的版本（後端回來的路徑、Markdown 內的連結都用這個）。 */
export function viewerKindOfPath(path: string): ViewerKind | null {
  const name = fileNameOf(path);
  const index = name.lastIndexOf(".");
  const extension = index > 0 ? name.slice(index + 1) : null;
  return viewerKindOf({ isDir: false, extension });
}

/**
 * 這個檢視器有沒有搜尋面板（文字類才有：Markdown、HTML、純文字／程式碼）。
 * 圖片與「沒有檢視器的類型」都不顯示搜尋鈕。
 */
export function supportsViewerSearch(kind: ViewerKind | null): boolean {
  return kind === "markdown" || kind === "html" || kind === "text" || kind === "docx";
}

/**
 * 這個檢視器的內容能不能加書籤（DOCX 與純文字／程式碼）。
 *
 * Markdown 已經有自動抽出的目錄索引；HTML 有預覽與原始碼兩種模式，只給原始碼加書籤
 * 會讓預覽模式看起來壞掉，所以不開放。純文字沿用搜尋的 4 MB 上限：對位要掃整份文字，
 * 超大檔案不適合（DOCX 自己已經有 `MAX_DOCX_BYTES`）。
 */
export function supportsViewerBookmarks(kind: ViewerKind | null, size: number): boolean {
  if (kind === "docx") {
    return true;
  }
  return kind === "text" && size <= MAX_SEARCH_TEXT;
}

/** 檢視器種類 → 書籤錨點種類（不支援的內容回 null）。 */
export function bookmarkKindOf(kind: ViewerKind | null): BookmarkKind | null {
  return kind === "docx" || kind === "text" ? kind : null;
}

/**
 * 這個檢視器的內容能不能用程式捲動（標頭的捲動鈕）。
 *
 * 圖片沒有捲動容器（只有 fit／實際大小切換）、PDF 是 WebView2 內建的 viewer
 * （在自己的一份文件裡，碰不到），兩者與「這個檔案沒有檢視器」的狀態都不顯示
 * 那一組按鈕。HTML 兩種模式都算：預覽捲 iframe 的文件、原始碼捲純文字容器。
 */
export function supportsViewerScroll(kind: ViewerKind | null): boolean {
  return kind === "markdown" || kind === "docx" || kind === "text" || kind === "html";
}

/**
 * 清單裡目前這張圖片的相鄰圖檔（純函數）。
 *
 * 只認檢視器畫得出來的圖檔（`VIEWER_IMAGE_EXTENSIONS`），順序沿用傳進來的清單 ——
 * 也就是來源窗格的可見順序（排序、搜尋關鍵字與隱藏項目都已經反映在裡面）。
 * `delta` 是 `-1`（上一張）或 `1`（下一張）；目前路徑不在清單裡、或已經在頭尾時回 `null`
 * （不循環），呼叫端據此把按鈕停用或整組隱藏。
 */
export function imageNeighbor(
  entries: FileEntry[],
  currentPath: string,
  delta: 1 | -1,
): FileEntry | null {
  const images = entries.filter((entry) => viewerKindOf(entry) === "image");
  const index = images.findIndex((entry) => samePath(entry.path, currentPath));
  if (index < 0) {
    return null;
  }
  return images[index + delta] ?? null;
}
