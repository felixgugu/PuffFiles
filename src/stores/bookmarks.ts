import { defineStore } from "pinia";
import { ref } from "vue";
import * as db from "@/services/bookmarks";
import { useUiStore } from "@/stores/ui";
import type { BookmarkAnchor, DocumentBookmark } from "@/types/bookmarks";
import { anchorPosition, sameAnchor } from "@/utils/bookmarkAnchor";
import { fileNameOf, normalizeKey } from "@/utils/path";

/** 沒有書籤的文件共用同一個空陣列，`computed` 的參考才不會每次換新。 */
const EMPTY: DocumentBookmark[] = [];

/**
 * DOCX 書籤（唯一真實來源）。
 *
 * 一次把全部紀錄讀進記憶體：書籤是一份文件幾筆、全部加起來幾十 KB 的東西，
 * 開機載入完就讓「這個檔案有哪些書籤」變成同步的查詢（`itemsFor`），
 * 免去每個檢視器各自處理載入狀態。寫入則只動被改到的那一份文件。
 */
export const useBookmarksStore = defineStore("bookmarks", () => {
  const ui = useUiStore();
  /** 正規化路徑 → 紀錄。 */
  const files = ref<Record<string, db.BookmarkFileRecord>>({});
  /** 已經為這次失敗提示過（成功寫入後重新武裝）。 */
  let warned = false;

  async function load(): Promise<void> {
    const records = await db.readBookmarkFiles();
    const next: Record<string, db.BookmarkFileRecord> = {};
    for (const record of records) {
      next[record.key] = record;
    }
    files.value = next;
  }

  /** 這份文件目前的書籤（依文件順序）。 */
  function itemsFor(path: string): DocumentBookmark[] {
    return files.value[normalizeKey(path)]?.items ?? EMPTY;
  }

  /** 同一個位置已經有書籤了嗎（同一位移、同一段文字）。 */
  function has(path: string, anchor: BookmarkAnchor): boolean {
    return itemsFor(path).some((item) => sameAnchor(item.anchor, anchor));
  }

  function add(path: string, anchor: BookmarkAnchor, label: string): DocumentBookmark {
    const item: DocumentBookmark = {
      id: newId(),
      label,
      anchor,
      createdAt: Date.now(),
    };
    commit(path, [...itemsFor(path), item]);
    return item;
  }

  /** 放回被刪除的那一筆（通知上的「復原」）；位置與建立時間都照舊。 */
  function restore(path: string, item: DocumentBookmark): void {
    const items = itemsFor(path).filter((entry) => entry.id !== item.id);
    commit(path, [...items, item]);
  }

  function rename(path: string, id: string, label: string): void {
    commit(
      path,
      itemsFor(path).map((item) => (item.id === id ? { ...item, label } : item)),
    );
  }

  /** 刪除一筆；回傳被刪掉的那一筆，讓呼叫端可以「復原」。 */
  function remove(path: string, id: string): DocumentBookmark | null {
    const items = itemsFor(path);
    const removed = items.find((item) => item.id === id) ?? null;
    if (!removed) {
      return null;
    }
    commit(
      path,
      items.filter((item) => item.id !== id),
    );
    return removed;
  }

  /**
   * 檔案重新命名時把紀錄搬到新路徑。
   *
   * 與 `viewer.retarget` 一起被重新命名流程呼叫：鍵是路徑，不搬的話書籤會留在
   * 一個已經不存在的檔案上（下次開新檔名的同一份文件就看不到書籤了）。
   */
  async function retarget(oldPath: string, newPath: string): Promise<void> {
    const from = normalizeKey(oldPath);
    const record = files.value[from];
    if (!record) {
      return;
    }
    const to = normalizeKey(newPath);
    const moved: db.BookmarkFileRecord = {
      key: to,
      path: newPath,
      name: fileNameOf(newPath) || newPath,
      updatedAt: Date.now(),
      items: record.items,
    };
    const next = { ...files.value };
    delete next[from];
    next[to] = moved;
    files.value = next;
    await db.deleteBookmarkFile(from);
    await persist(moved);
  }

  /** 改動一份文件的書籤：先更新記憶體（畫面立刻反應），再落地。 */
  function commit(path: string, items: DocumentBookmark[]): void {
    const key = normalizeKey(path);
    const next = { ...files.value };
    if (!items.length) {
      delete next[key];
      files.value = next;
      void db.deleteBookmarkFile(key);
      return;
    }
    const record: db.BookmarkFileRecord = {
      key,
      path,
      name: fileNameOf(path) || path,
      updatedAt: Date.now(),
      items: order(items),
    };
    next[key] = record;
    files.value = next;
    void persist(record);
  }

  async function persist(record: db.BookmarkFileRecord): Promise<void> {
    const saved = await db.writeBookmarkFile(record);
    // 寫不進去遲早會變成「書籤不見了」，不能默默吞掉；同一次失敗只提示一次。
    if (!saved && !warned) {
      warned = true;
      ui.showNotice("書籤無法寫入本機資料庫，這次的變更只留在畫面上");
    } else if (saved) {
      warned = false;
    }
  }

  /** 一律照文件位置排序：面板由上往下就是文件由前往後，捲動同步才有意義。 */
  function order(items: DocumentBookmark[]): DocumentBookmark[] {
    return [...items].sort(
      (a, b) => anchorPosition(a.anchor) - anchorPosition(b.anchor) || a.createdAt - b.createdAt,
    );
  }

  return {
    files,
    load,
    itemsFor,
    has,
    add,
    restore,
    rename,
    remove,
    retarget,
  };
});

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
