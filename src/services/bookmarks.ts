import type { BookmarkAnchor, DocumentBookmark } from "@/types/bookmarks";

/**
 * DOCX 書籤的持久化（IndexedDB）。
 *
 * **為什麼不是 localStorage**：`services/storage.ts` 那條路是給「設定、瀏覽紀錄、
 * 工作階段」這種幾 KB、一次寫一整包的東西用的。書籤會隨「看過幾份文件」一直長，
 * 而且每份文件各自讀寫；共用同一個 5 MB 配額的 localStorage 遲早會塞爆，
 * `writeJson` 遇到配額不足只能放棄（見 storage.ts），也就是**無聲的資料遺失**。
 * IndexedDB 的配額大得多、非同步寫入不卡介面，形狀也更適合「一份文件一筆紀錄」。
 *
 * 資料庫固定是 `pufffile`／store `docx-bookmarks`，主鍵是正規化路徑
 * （`utils/path.ts` 的 `normalizeKey()`：統一斜線、去尾端斜線、忽略大小寫），
 * 所以同一個檔案不管從哪個入口開啟都指向同一份書籤。
 *
 * IndexedDB 不可用（例如無痕模式、資料庫被停用）時退回記憶體：當次工作階段仍可新增、
 * 跳轉與刪除，只是關掉視窗就不見。
 */

/** 一份文件在資料庫裡的一筆紀錄。 */
export interface BookmarkFileRecord {
  /** 正規化路徑（主鍵）。 */
  key: string;
  /** 原始路徑（保留大小寫與斜線），供重新命名時搬移與顯示。 */
  path: string;
  name: string;
  updatedAt: number;
  items: DocumentBookmark[];
}

const DB_NAME = "pufffile";
const DB_VERSION = 1;
/**
 * Store 名稱沿用當初只有 DOCX 書籤時的名字。
 *
 * 改名要動資料庫版本並搬資料，而「同一個鍵、同一種紀錄」本來就沒有語意問題；
 * 真的非改不可時，做法是 `DB_VERSION` 加一、在 `onupgradeneeded` 裡把舊 store
 * 的紀錄搬過去再刪掉舊的。
 */
const STORE_NAME = "docx-bookmarks";

/** 沒有 IndexedDB 時的替代存放區（只活在這個工作階段）。 */
const memory = new Map<string, BookmarkFileRecord>();
let opening: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (opening) {
    return opening;
  }
  opening = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    // 開不起來（被停用、版本被別的視窗佔住）就退回記憶體，功能不會整組壞掉。
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opening;
}

/** 讀出全部紀錄；讀不到（或沒有 IndexedDB）時回記憶體裡的內容。 */
export async function readBookmarkFiles(): Promise<BookmarkFileRecord[]> {
  const database = await openDatabase();
  if (!database) {
    return [...memory.values()];
  }
  return new Promise((resolve) => {
    const fallback = () => resolve([...memory.values()]);
    try {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        const rows = Array.isArray(request.result) ? request.result : [];
        resolve(rows.map(sanitizeRecord).filter((row): row is BookmarkFileRecord => row !== null));
      };
      request.onerror = fallback;
    } catch {
      fallback();
    }
  });
}

/** 寫入一份文件的紀錄；回傳是否真的落地（false＝這次只留在記憶體）。 */
export async function writeBookmarkFile(record: BookmarkFileRecord): Promise<boolean> {
  // 一定要先轉成純資料：呼叫端傳進來的多半是 Pinia 的響應式代理，
  // 而 IndexedDB 用結構化複製，**代理物件複製不了**（DataCloneError）——
  // 那會變成「第一筆寫得進去、之後每一筆都默默失敗」。
  const plain = plainRecord(record);
  memory.set(plain.key, plain);
  const database = await openDatabase();
  if (!database) {
    return false;
  }
  return new Promise((resolve) => {
    try {
      const request = database
        .transaction(STORE_NAME, "readwrite")
        .objectStore(STORE_NAME)
        .put(plain);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** 移除一份文件的紀錄（檔案重新命名時搬移用）。 */
export async function deleteBookmarkFile(key: string): Promise<boolean> {
  memory.delete(key);
  const database = await openDatabase();
  if (!database) {
    return false;
  }
  return new Promise((resolve) => {
    try {
      const request = database
        .transaction(STORE_NAME, "readwrite")
        .objectStore(STORE_NAME)
        .delete(key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * 複製成純資料。
 *
 * 除了避開代理物件，這也把「資料形狀」收在一個地方：寫進去的欄位與
 * `sanitizeRecord()` 讀出來的欄位一致，不會因為呼叫端多塞了東西而膨脹。
 */
function plainRecord(record: BookmarkFileRecord): BookmarkFileRecord {
  return {
    key: record.key,
    path: record.path,
    name: record.name,
    updatedAt: record.updatedAt,
    items: record.items.map((item) => ({
      id: item.id,
      label: item.label,
      createdAt: item.createdAt,
      anchor:
        item.anchor.kind === "docx"
          ? {
              kind: "docx",
              text: item.anchor.text,
              offset: item.anchor.offset,
              length: item.anchor.length,
              blockIndex: item.anchor.blockIndex,
              blockText: item.anchor.blockText,
            }
          : {
              kind: "text",
              text: item.anchor.text,
              offset: item.anchor.offset,
              length: item.anchor.length,
              line: item.anchor.line,
              lineText: item.anchor.lineText,
            },
    })),
  };
}

/**
 * 讀進來的資料一律重新驗證。
 *
 * 資料庫的內容是上一次執行留下的（版本升級、外部工具寫入都可能讓它變形），
 * 壞掉的一筆只能丟掉，不能讓整個書籤目錄跟著壞。
 */
function sanitizeRecord(value: unknown): BookmarkFileRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<BookmarkFileRecord>;
  if (typeof record.key !== "string" || !record.key || !Array.isArray(record.items)) {
    return null;
  }
  const items = record.items
    .map(sanitizeItem)
    .filter((item): item is DocumentBookmark => item !== null);
  if (!items.length) {
    return null;
  }
  const path = typeof record.path === "string" && record.path ? record.path : record.key;
  return {
    key: record.key,
    path,
    name: typeof record.name === "string" && record.name ? record.name : path,
    updatedAt: numberOr(record.updatedAt, 0),
    items,
  };
}

function sanitizeItem(value: unknown): DocumentBookmark | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Partial<DocumentBookmark>;
  // 逐欄位讀：資料庫裡的內容可能是舊版或外部寫入的，不能假設它符合現在的型別。
  const anchor = item.anchor as RawAnchor | undefined;
  if (typeof item.id !== "string" || !item.id || !anchor || typeof anchor !== "object") {
    return null;
  }
  const text = stringOr(anchor.text, "");
  const offset = Math.max(0, numberOr(anchor.offset, 0));
  const length = Math.max(0, numberOr(anchor.length, 0));
  // `kind` 是 2026-10-09 加入的欄位：沒有它的紀錄一律當成 DOCX（舊版只有這一種）。
  const kind = anchor.kind === "text" ? "text" : "docx";
  const parsed: BookmarkAnchor =
    kind === "text"
      ? {
          kind,
          text,
          offset,
          length,
          line: Math.max(1, Math.round(numberOr(anchor.line, 1))),
          lineText: stringOr(anchor.lineText, ""),
        }
      : {
          kind,
          text,
          offset,
          length,
          blockIndex: Math.max(0, Math.round(numberOr(anchor.blockIndex, 0))),
          blockText: stringOr(anchor.blockText, ""),
        };
  if (kind === "docx" && !Number.isFinite(anchor.blockIndex)) {
    // 沒有區塊索引的 DOCX 錨點無從定位。
    return null;
  }
  return {
    id: item.id,
    label: typeof item.label === "string" && item.label ? item.label : "書籤",
    createdAt: numberOr(item.createdAt, 0),
    anchor: parsed,
  };
}

/** 資料庫裡還沒驗證過的錨點；欄位一律當成未知型別。 */
interface RawAnchor {
  kind?: unknown;
  text?: unknown;
  offset?: unknown;
  length?: unknown;
  blockIndex?: unknown;
  blockText?: unknown;
  line?: unknown;
  lineText?: unknown;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
