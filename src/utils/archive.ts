import type { ArchiveEntry } from "@/types/archive";

/**
 * 壓縮檔的純函數與副檔名清單（無副作用，不碰 store 或 IPC）。
 *
 * 副檔名清單是**唯一來源**：`utils/fileKind.ts`（圖示與分類）與設定頁的 7-Zip
 * 外部工具都從這裡取，避免「檢視器認得、右鍵選單不認得」這種不一致。
 * 範圍刻意與 7-Zip 的能力一致（見 `docs/redesign-plan.md`）。
 */
export const ARCHIVE_EXTENSIONS = [
  "zip",
  "zipx",
  "7z",
  "rar",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "tbz",
  "xz",
  "txz",
  "zst",
  "cab",
  "iso",
  "wim",
  "arj",
  "lzh",
  "z",
  "lzma",
] as const;

const ARCHIVE_EXTENSION_SET: ReadonlySet<string> = new Set(ARCHIVE_EXTENSIONS);

/** 與後端 `core::archive::MAX_ENTRIES` 同一個數字。 */
export const MAX_ARCHIVE_ENTRIES = 20_000;

export type ArchiveSortKey = "name" | "size" | "modified";

/** 一列＝一個項目；`folder`／`name` 是名稱欄的淡色前綴與檔名。 */
export interface ArchiveRow {
  entry: ArchiveEntry;
  /** 清單的 key：同名項目重複時也要唯一。 */
  key: string;
  /** 資料夾前綴（含結尾分隔符）；根目錄的項目是空字串。 */
  folder: string;
  name: string;
  /** 篩選與名稱排序共用：小寫的完整路徑。 */
  searchKey: string;
}

const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });

/** 這個副檔名（不含點、小寫）是不是壓縮檔。 */
export function isArchiveExtension(extension: string | null | undefined): boolean {
  return !!extension && ARCHIVE_EXTENSION_SET.has(extension.toLocaleLowerCase());
}

/** 把壓縮檔內的相對路徑拆成「資料夾前綴」與「檔名」；`/` 與 `\` 都接受。 */
export function splitArchivePath(path: string): { folder: string; name: string } {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index < 0
    ? { folder: "", name: path }
    : { folder: path.slice(0, index + 1), name: path.slice(index + 1) };
}

/** 名稱欄的圖示要用的副檔名（不含點、小寫）。 */
export function archiveExtensionOf(path: string): string {
  const { name } = splitArchivePath(path);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLocaleLowerCase() : "";
}

/** 建立顯示用的列（順序沿用後端，篩選與排序另外做）。 */
export function archiveRows(entries: readonly ArchiveEntry[]): ArchiveRow[] {
  return entries.map((entry, index) => {
    const { folder, name } = splitArchivePath(entry.path);
    return {
      entry,
      key: `${index}:${entry.path}`,
      folder,
      name,
      searchKey: entry.path.toLocaleLowerCase(),
    };
  });
}

/** 篩選：不分大小寫，比對完整相對路徑（含資料夾）。 */
export function filterArchiveRows(rows: readonly ArchiveRow[], query: string): ArchiveRow[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle ? rows.filter((row) => row.searchKey.includes(needle)) : [...rows];
}

/**
 * 排序；同值時一律以路徑升冪收尾，畫面才不會在每次重算時跳動。
 *
 * 名稱用與檔案清單同一組 collator（中文、數字都照排）；大小是數值；時間是
 * 後端給的 `YYYY-MM-DD HH:MM:SS` 字串，直接比字串就等於比時間。
 */
export function sortArchiveRows(
  rows: readonly ArchiveRow[],
  key: ArchiveSortKey,
  direction: "asc" | "desc",
): ArchiveRow[] {
  const factor = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    let result: number;
    switch (key) {
      case "size":
        result = a.entry.size - b.entry.size;
        break;
      case "modified":
        result = (a.entry.modified ?? "").localeCompare(b.entry.modified ?? "");
        break;
      default:
        result = collator.compare(a.entry.path, b.entry.path);
    }
    return result === 0 ? collator.compare(a.entry.path, b.entry.path) : result * factor;
  });
}

/** 時間欄的顯示文字；後端已經去掉小數秒，這裡只是防禦性再切一次。 */
export function formatArchiveTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  return value.length > 19 && value[19] === "." ? value.slice(0, 19) : value;
}
