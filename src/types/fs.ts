/** 與 Rust 端 `model.rs` 對應的前端型別（後端一律輸出 camelCase）。 */

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  isHidden: boolean;
  /** Windows 唯讀屬性。 */
  isReadonly: boolean;
  /** 資料夾固定為 0。 */
  size: number;
  modifiedMs: number | null;
  createdMs: number | null;
  extension: string | null;
}

/** `list_dir_stream` 透過 Tauri Channel 推送的事件。 */
export type DirStreamEvent =
  | { type: "start"; path: string; name: string; parent: string | null }
  | { type: "batch"; entries: FileEntry[] }
  | { type: "done"; total: number; truncated: boolean };

export type DriveKind = "fixed" | "removable" | "network" | "unknown";

export interface DriveInfo {
  name: string;
  mountPoint: string;
  label: string;
  kind: DriveKind;
  totalBytes: number;
  availableBytes: number;
  isRemovable: boolean;
}

export interface QuickLocation {
  id: string;
  label: string;
  path: string;
  kind: string;
}

export type SortKey = "name" | "modified" | "created" | "kind" | "size";
export type SortDirection = "asc" | "desc";

export interface PathSegment {
  label: string;
  path: string;
}

/** 窗格（Pane）＝一個「資料夾樹 + 檔案清單」的瀏覽單元。 */
export type PaneId = string;

/** `row` = 左右並排；`column` = 上下堆疊。 */
export type SplitDirection = "row" | "column";

export interface TabState {
  id: string;
  paneIds: PaneId[];
  direction: SplitDirection;
  activePaneId: PaneId;
  /** 第一個窗格所佔的比例（0.2 ~ 0.8）。 */
  ratio: number;
}

/** 左側樹狀清單的使用者自訂資料夾根。 */
export interface FolderRoot {
  id: string;
  path: string;
  label: string;
}

export interface HistoryEntry {
  /**
   * 這筆紀錄的路徑。
   * 一個＝單窗瀏覽；兩個＝當時的分割版面，順序固定是「左／上、右／下」。
   */
  paths: string[];
  /** 分割方向；只有兩個路徑時才有意義。 */
  direction?: SplitDirection;
  at: number;
}

export type ColumnId = "name" | "kind" | "size" | "modified" | "created" | "attributes" | "path";
