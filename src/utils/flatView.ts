import type { FileEntry } from "@/types/fs";
import { relativeTo } from "@/utils/path";

/**
 * 扁平化展示（見 AGENTS.md §3.1）：清單裡的每一列都要說出自己在哪個子資料夾。
 *
 * 這裡只放純函數：相對路徑的拆解、排序比較。後端的走訪順序是「先淺後深、同一層依
 * 相對路徑」，`compareFlatOrder()` 刻意重現同一個順序 —— 兩邊一致時，名字升冪排序
 * 可以直接沿用後端送來的順序（見 `stores/explorer.ts` 的 `backendSorted`）。
 */

/** 一次扁平化列舉最多列出的檔案數；與後端 `core::flat::MAX_FILES` 是同一個數字。 */
export const FLAT_VIEW_LIMIT = 50_000;

export interface FlatLabel {
  /** 產生這份標籤的根目錄：同一個項目換根目錄時要重算。 */
  root: string;
  /** 相對於根目錄的資料夾前綴，含結尾的反斜線；根目錄自己的檔案是空字串。 */
  folder: string;
  name: string;
  /** 名稱欄顯示的完整文字（前綴＋檔名）；搜尋與「自動調整欄寬」都用它。 */
  label: string;
  /** 排序／搜尋用的鍵：小寫的相對路徑。 */
  key: string;
  /** 深度＝相對路徑裡的反斜線數量（越淺越前面）。 */
  depth: number;
}

const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });

/**
 * 快取算過的相對路徑。
 *
 * 同一次列舉裡的項目物件是穩定的（`shallowRef` 陣列，只有整份換掉時才變），所以用
 * `WeakMap` 以項目為鍵就夠了；排序與每次批次的重算不必反覆切字串。根目錄換了
 * （同一個項目換到另一棵樹底下）就重算。
 */
const cache = new WeakMap<FileEntry, FlatLabel>();

/** 一個項目在扁平化清單裡的名稱：`資料夾\子資料夾\` ＋ 檔名。 */
export function flatLabelOf(entry: FileEntry, root: string): FlatLabel {
  const cached = cache.get(entry);
  if (cached && cached.root === root) {
    return cached;
  }

  const relative = relativeTo(root, entry.path);
  const value = relative === null ? fallback(entry, root) : fromRelative(entry, root, relative);
  cache.set(entry, value);
  return value;
}

/** 扁平化清單的預設順序：先比深度，再比相對路徑（與後端的走訪順序一致）。 */
export function compareFlatOrder(a: FileEntry, b: FileEntry, root: string): number {
  const left = flatLabelOf(a, root);
  const right = flatLabelOf(b, root);
  return left.depth - right.depth || collator.compare(left.key, right.key);
}

function fromRelative(entry: FileEntry, root: string, relative: string): FlatLabel {
  // 正常情況下相對路徑就是以檔名結尾，切掉它剩下的就是資料夾前綴（含結尾的反斜線）。
  const folder = relative.endsWith(entry.name)
    ? relative.slice(0, relative.length - entry.name.length)
    : "";
  // 極少數情況（後端回報的名稱與路徑不一致）時退回檔名，不要顯示半截路徑。
  const label = relative.endsWith(entry.name) ? relative : entry.name;

  return {
    root,
    folder,
    name: entry.name,
    label,
    key: label.toLocaleLowerCase(),
    depth: (folder.match(/\\/g) ?? []).length,
  };
}

/** 項目不在根目錄底下時不假裝有前綴：只顯示檔名（理論上不會發生）。 */
function fallback(entry: FileEntry, root: string): FlatLabel {
  return {
    root,
    folder: "",
    name: entry.name,
    label: entry.name,
    key: entry.name.toLocaleLowerCase(),
    depth: 0,
  };
}
