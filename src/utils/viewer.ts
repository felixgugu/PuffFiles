import type { FileEntry } from "@/types/fs";
import type { ViewerKind } from "@/types/viewer";
import { fileKindOf } from "@/utils/fileKind";
import { fileNameOf } from "@/utils/path";

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
 * 從 `fromIndex` 的下一列往下找第一個能用檢視器開啟的檔案；找不到回 `-1`。
 *
 * `viewerKindOf()` 對資料夾與沒有檢視器的副檔名（.pdf／.mp4／.exe…）都回 `null`，
 * 所以一個判斷同時跳過這兩種，呼叫端不必再各自過濾一次。
 */
export function nextViewableFileIndex(
  entries: readonly Pick<FileEntry, "isDir" | "extension">[],
  fromIndex: number,
): number {
  for (let index = Math.max(fromIndex + 1, 0); index < entries.length; index++) {
    if (viewerKindOf(entries[index])) {
      return index;
    }
  }
  return -1;
}
