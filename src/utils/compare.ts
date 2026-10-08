import type { FileEntry } from "@/types/fs";

/**
 * 目錄比對的純函數（見 §同步瀏覽與目錄比對）。
 *
 * 兩個窗格通常在**不同的資料夾**（例如 `C:\專案\v1` 對 `D:\備份\專案\v1`），
 * 所以配對的鍵是「檔名」而不是路徑。狀態只有三種：相同（不上色）、
 * 只在這一邊（`only`）、兩邊都有但不同（`different`）。
 */

/** 檔案「相同」的修改時間寬容值（毫秒）：FAT／exFAT 的時間戳粒度是 2 秒。 */
export const COMPARE_TIME_TOLERANCE_MS = 2000;

/** 比對狀態；`null`＝相同（不上色）。 */
export type CompareState = "only" | "different";

/** 檔名的比對鍵：Windows 的檔案系統不分大小寫。 */
export function compareKey(name: string): string {
  return name.toLocaleLowerCase();
}

/**
 * 兩邊都有的檔案算不算同一個版本：大小相同，而且修改時間在寬容值內。
 *
 * 拿不到時間戳（例如某些網路磁碟）時只比大小 —— 不能因為少了時間就整片標成不同。
 */
export function sameFileVersion(left: FileEntry, right: FileEntry): boolean {
  if (left.size !== right.size) {
    return false;
  }
  if (left.modifiedMs === null || right.modifiedMs === null) {
    return true;
  }
  return Math.abs(left.modifiedMs - right.modifiedMs) <= COMPARE_TIME_TOLERANCE_MS;
}

/**
 * 這一邊的項目對上另一邊的同名項目（`other` 為 undefined＝另一邊沒有）。
 *
 * 資料夾只比對「存在與否」與型別，不遞迴比較內容 —— 與檔案總管、FileZilla 相同。
 */
export function compareEntry(entry: FileEntry, other: FileEntry | undefined): CompareState | null {
  if (!other) {
    return "only";
  }
  if (entry.isDir !== other.isDir) {
    return "different";
  }
  if (entry.isDir) {
    return null;
  }
  return sameFileVersion(entry, other) ? null : "different";
}

/** 把另一邊的清單做成「檔名（小寫）→ 項目」的索引。 */
export function indexByName(entries: FileEntry[]): Map<string, FileEntry> {
  const index = new Map<string, FileEntry>();
  for (const entry of entries) {
    index.set(compareKey(entry.name), entry);
  }
  return index;
}
