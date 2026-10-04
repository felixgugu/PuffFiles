import type { ColumnId, FileEntry } from "@/types/fs";
import { kindLabel } from "@/utils/fileKind";
import { formatBytes, formatDateTime } from "@/utils/format";

/** 屬性欄的文字：唯讀／隱藏／連結，以「・」相連。 */
export function attributesOf(
  entry: Pick<FileEntry, "isReadonly" | "isHidden" | "isSymlink">,
): string {
  const values: string[] = [];
  if (entry.isReadonly) {
    values.push("唯讀");
  }
  if (entry.isHidden) {
    values.push("隱藏");
  }
  if (entry.isSymlink) {
    values.push("連結");
  }
  return values.join("・");
}

/**
 * 一格要顯示的文字。
 *
 * 名稱欄在畫面上是「圖示＋名稱＋徽章」的自訂排版，這裡只回傳名稱本身，
 * 讓「自動調整欄寬」能跟其他欄位走同一條量測路徑（規則只有這一份，不會走鐘）。
 */
export function cellText(column: ColumnId, entry: FileEntry): string {
  switch (column) {
    case "name":
      return entry.name;
    case "kind":
      return kindLabel(entry);
    case "size":
      return entry.isDir ? "—" : formatBytes(entry.size);
    case "modified":
      return formatDateTime(entry.modifiedMs);
    case "created":
      return formatDateTime(entry.createdMs);
    case "attributes":
      return attributesOf(entry);
    case "path":
      return entry.path;
    default:
      return "";
  }
}
