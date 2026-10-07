import type { FileEntry } from "@/types/fs";
import type { ViewerKind } from "@/types/viewer";
import { fileKindOf } from "@/utils/fileKind";
import { fileNameOf, samePath } from "@/utils/path";

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
  return kind === "markdown" || kind === "html" || kind === "text";
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
