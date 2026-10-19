import { defineStore } from "pinia";
import { reactive, shallowRef, triggerRef, watch, type ShallowRef } from "vue";
import * as api from "@/services/api";
import { copyText } from "@/services/clipboard";
import { normalizeBackendError, type AppErrorView } from "@/services/errors";
import { COLUMN_DEFAULTS, COLUMN_MIN, useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { useViewerStore } from "@/stores/viewer";
import type {
  ColumnId,
  DirStreamEvent,
  FileEntry,
  PaneId,
  SortDirection,
  SortKey,
} from "@/types/fs";
import type { WatchEvent } from "@/services/api";
import { kindLabel } from "@/utils/fileKind";
import { compareFlatOrder, flatLabelOf } from "@/utils/flatView";
import { fileNameOf, normalizeKey, parentOf, samePath, toUnixPath } from "@/utils/path";

export type ExplorerStatus = "idle" | "loading" | "ready" | "error";

/**
 * 上一頁／下一頁要還原的清單狀態。
 *
 * 路徑本身不足以回到「原來的位置」：Windows 檔案總管返回時也會還原選取、焦點列與
 * 捲動位置。`focusedPath` 是主要依據；清單內容變動、該項目消失時才退回 `focusedIndex`。
 */
export interface NavigationSnapshot {
  path: string;
  selectedPaths: string[];
  focusedPath: string | null;
  focusedIndex: number;
  scrollTop: number;
}

/** 單一窗格的瀏覽狀態。每個窗格各自獨立，互不干擾。 */
export interface PaneMeta {
  id: PaneId;
  currentPath: string;
  currentName: string;
  parentPath: string | null;
  status: ExplorerStatus;
  error: AppErrorView | null;
  query: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
  selected: string[];
  focusedIndex: number;
  backStack: NavigationSnapshot[];
  forwardStack: NavigationSnapshot[];
  truncated: boolean;
  total: number;
  /** 檔案清單目前的垂直捲動位置；供上一頁／下一頁重建視野。 */
  scrollTop: number;
  /** 一次性請求：虛擬清單完成渲染後要跳到的位置。`token` 讓相同位置也能重播。 */
  scrollRestore: { token: number; top: number } | null;
  /**
   * 扁平化展示：直接列出這個資料夾底下（含所有子資料夾）的檔案，而不是只列一層。
   *
   * 每個窗格各自獨立（見 AGENTS.md §3.1）；開啟時不掛目錄監控，要手動重新整理。
   */
  flat: boolean;
  /** 上一次扁平化列舉略過的資料夾數（讀不到）；一般清單固定 0。 */
  skipped: number;
  /** 這個窗格自己的欄位寬度；兩個窗格互不影響。 */
  columnWidths: Record<string, number>;
}

const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });

/** 變更通知的合併視窗：一次爆炸性變更只重算一次。 */
const WATCH_FLUSH_MS = 80;

/** 超過這個數量就延後排序，避免串流過程中反覆排序拖慢 UI。 */
const EAGER_SORT_LIMIT = 2000;

/**
 * 瀏覽引擎：所有窗格的資料夾內容、選取、排序與瀏覽歷史。
 *
 * 大量項目沿用 `shallowRef` + `triggerRef`：項目本身不建立響應式代理，
 * 只有在篩選／排序後才產生一份新的可見陣列。
 */
export const useExplorerStore = defineStore("explorer", () => {
  const settings = useSettingsStore();
  const ui = useUiStore();
  const viewer = useViewerStore();

  const panes = reactive<Record<PaneId, PaneMeta>>({});
  const entriesByPane = new Map<PaneId, ShallowRef<FileEntry[]>>();
  const visibleByPane = new Map<PaneId, ShallowRef<FileEntry[]>>();
  const controllers = new Map<PaneId, AbortController>();
  /** 窗格正在監控的路徑。 */
  const watchedPaths = new Map<PaneId, string>();
  /** 等待套用的變更：同一路徑只留最後一筆。 */
  const pendingChanges = new Map<PaneId, Map<string, WatchEvent>>();
  const flushTimers = new Map<PaneId, ReturnType<typeof setTimeout>>();
  let sequence = 0;
  let scrollRequestSequence = 0;

  function entriesRef(id: PaneId): ShallowRef<FileEntry[]> {
    return entriesByPane.get(id)!;
  }

  function visibleRef(id: PaneId): ShallowRef<FileEntry[]> {
    return visibleByPane.get(id)!;
  }

  /**
   * 完整清單（未經隱藏項目與搜尋篩選、也還沒排序），窗格不存在時回空陣列。
   *
   * 目錄比對與「另一邊有沒有同名資料夾」都要看完整清單 —— 畫面被篩選過的內容
   * 不能拿來判斷檔案系統的實況。
   */
  function entries(id: PaneId): FileEntry[] {
    return entriesByPane.get(id)?.value ?? [];
  }

  function meta(id: PaneId): PaneMeta | undefined {
    return panes[id];
  }

  function createPane(
    initialPath = "",
    widths?: Record<string, number>,
    flat = false,
  ): PaneId {
    const id = `pane-${++sequence}`;
    panes[id] = {
      id,
      currentPath: initialPath,
      currentName: "",
      parentPath: null,
      status: "idle",
      error: null,
      query: "",
      sortKey: settings.defaultSortKey,
      sortDirection: settings.defaultSortDirection,
      selected: [],
      focusedIndex: 0,
      backStack: [],
      forwardStack: [],
      truncated: false,
      total: 0,
      scrollTop: 0,
      scrollRestore: null,
      flat,
      skipped: 0,
      // 新窗格從設定裡的預設欄寬出發，之後就各自獨立。
      // 注意 `...widths` 是複製：兩個窗格不能共用同一個物件，否則拖曳會互相影響。
      columnWidths: { ...COLUMN_DEFAULTS, ...settings.columnWidths, ...(widths ?? {}) },
    };
    entriesByPane.set(id, shallowRef<FileEntry[]>([]));
    visibleByPane.set(id, shallowRef<FileEntry[]>([]));
    return id;
  }

  function destroyPane(id: PaneId) {
    controllers.get(id)?.abort();
    controllers.delete(id);
    // 走訪在後端的阻塞執行緒上跑，中止訊號到不了那裡，要另外請它收工。
    void api.cancelFlatScan(id).catch(() => undefined);
    stopWatch(id);
    viewer.destroy(id);
    entriesByPane.delete(id);
    visibleByPane.delete(id);
    delete panes[id];
  }

  /** 後端順序：資料夾優先，其次不分大小寫的名稱。 */
  function compareForBackend(a: FileEntry, b: FileEntry): number {
    return a.isDir === b.isDir ? collator.compare(a.name, b.name) : a.isDir ? -1 : 1;
  }

  function insertSorted(list: FileEntry[], entry: FileEntry) {
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (compareForBackend(list[middle], entry) <= 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    list.splice(low, 0, entry);
  }

  function stopWatch(id: PaneId) {
    if (!watchedPaths.delete(id)) {
      return;
    }
    const timer = flushTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      flushTimers.delete(id);
    }
    pendingChanges.delete(id);
    void api.unwatchDirectory(id).catch(() => undefined);
  }

  function startWatch(id: PaneId, path: string) {
    if (!settings.autoRefresh || !path || watchedPaths.get(id) === path) {
      return;
    }
    stopWatch(id);
    watchedPaths.set(id, path);
    void api
      .watchDirectory(id, path, (event) => queueChange(id, event))
      .catch(() => {
        // 有些位置（例如部分網路磁碟）不支援監控；靜靜放棄，清單仍然可以手動重新整理。
        watchedPaths.delete(id);
      });
  }

  function queueChange(id: PaneId, event: WatchEvent) {
    if (!panes[id]) {
      return;
    }
    // 同一個路徑只留最後一筆：新增後又刪除，最後就是刪除。
    const bucket = pendingChanges.get(id) ?? new Map<string, WatchEvent>();
    bucket.set(event.path.toLocaleLowerCase(), event);
    pendingChanges.set(id, bucket);

    if (!flushTimers.has(id)) {
      flushTimers.set(
        id,
        setTimeout(() => {
          flushTimers.delete(id);
          applyChanges(id);
        }, WATCH_FLUSH_MS),
      );
    }
  }

  /**
   * 把累積的變更套用到清單上。
   *
   * 刻意不做「整份重讀」：那會清掉選取、把捲軸拉回頂端，變成每次存檔畫面都跳掉。
   * 只有真的漏掉通知（rescan）時才退回重讀。
   */
  function applyChanges(id: PaneId) {
    const pane = panes[id];
    const bucket = pendingChanges.get(id);
    pendingChanges.delete(id);
    if (!pane || !bucket || bucket.size === 0) {
      return;
    }

    const events = [...bucket.values()];
    if (events.some((event) => event.kind === "rescan")) {
      void load(id, pane.currentPath);
      return;
    }

    const removed = new Set<string>();
    const upserts: FileEntry[] = [];
    for (const event of events) {
      if (event.kind === "removed") {
        removed.add(event.path);
      } else if (event.entry) {
        upserts.push(event.entry);
      }
    }

    const current = entriesByPane.get(id)?.value;
    if (!current) {
      return;
    }
    // 一律換成新陣列，shallowRef 才會觸發更新。
    const next = removed.size ? current.filter((item) => !removed.has(item.path)) : [...current];
    const known = new Set(next.map((item) => item.path));

    for (const entry of upserts) {
      const index = next.findIndex((item) => item.path === entry.path);
      if (index >= 0) {
        next[index] = entry;
      } else if (!known.has(entry.path)) {
        insertSorted(next, entry);
        known.add(entry.path);
      }
    }

    const target = entriesByPane.get(id);
    if (target) {
      target.value = next;
    }
    recompute(id);
  }

  /**
   * 一般清單的排序：資料夾優先，其餘依欄位。
   *
   * `flatRoot` 有值時走扁平化展示的規則（見下）：清單裡只有檔案，「先淺後深、同一層依
   * 相對路徑」就是它的預設順序 —— 其他欄位平手時也拿它當第二鍵，否則同名檔案會散開。
   */
  function compare(
    a: FileEntry,
    b: FileEntry,
    key: SortKey,
    direction: SortDirection,
    flatRoot: string | null = null,
  ): number {
    if (flatRoot !== null) {
      const flatBase = (() => {
        switch (key) {
          case "modified":
            return (a.modifiedMs ?? 0) - (b.modifiedMs ?? 0) || compareFlatOrder(a, b, flatRoot);
          case "created":
            return (a.createdMs ?? 0) - (b.createdMs ?? 0) || compareFlatOrder(a, b, flatRoot);
          case "size":
            return a.size - b.size || compareFlatOrder(a, b, flatRoot);
          case "kind":
            return (
              collator.compare(kindLabel(a), kindLabel(b)) || compareFlatOrder(a, b, flatRoot)
            );
          default:
            return compareFlatOrder(a, b, flatRoot);
        }
      })();
      return direction === "asc" ? flatBase : -flatBase;
    }

    // 資料夾永遠排在最前面，與 Windows 檔案總管一致。
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }

    const base = (() => {
      switch (key) {
        case "modified":
          return (a.modifiedMs ?? 0) - (b.modifiedMs ?? 0);
        case "created":
          return (a.createdMs ?? 0) - (b.createdMs ?? 0);
        case "size":
          return a.size - b.size;
        case "kind":
          return collator.compare(kindLabel(a), kindLabel(b)) || collator.compare(a.name, b.name);
        default:
          return collator.compare(a.name, b.name);
      }
    })();

    return direction === "asc" ? base : -base;
  }

  /** 搜尋比對用的文字：一般清單是檔名，扁平化時是相對路徑（子資料夾名稱也搜得到）。 */
  function searchText(item: FileEntry, flatRoot: string | null): string {
    return flatRoot ? flatLabelOf(item, flatRoot).key : item.name.toLocaleLowerCase();
  }

  /** 依搜尋字串、隱藏項目與排序條件重算可見清單。 */
  function recompute(id: PaneId) {
    const pane = panes[id];
    const target = visibleByPane.get(id);
    if (!pane || !target) {
      return;
    }

    const source = entriesByPane.get(id)!.value;
    const keyword = pane.query.trim().toLocaleLowerCase();
    const backendSorted = pane.sortKey === "name" && pane.sortDirection === "asc" && !keyword;
    // 扁平化時後端送來的順序就是它的預設順序（`compareFlatOrder` 重現同一個順序）。
    const flatRoot = pane.flat && pane.currentPath ? pane.currentPath : null;
    const next: FileEntry[] = [];

    for (const item of source) {
      if (!settings.showHidden && item.isHidden) {
        continue;
      }
      if (keyword && !searchText(item, flatRoot).includes(keyword)) {
        continue;
      }
      next.push(item);
    }

    if (!backendSorted && (pane.status !== "loading" || source.length <= EAGER_SORT_LIMIT)) {
      next.sort((a, b) => compare(a, b, pane.sortKey, pane.sortDirection, flatRoot));
    }

    target.value = next;
    pane.total = source.length;
    if (pane.focusedIndex >= next.length) {
      pane.focusedIndex = Math.max(0, next.length - 1);
    }
  }

  /*
   * 顯示隱藏項目的偏好是全域的：一般清單只是把已讀到的項目再篩一次，所以就地重算；
   * 扁平化展示連「要不要走進隱藏資料夾」都跟著這個開關（後端就不掃了），只能重讀。
   */
  watch(
    () => settings.showHidden,
    () => {
      for (const id of Object.keys(panes)) {
        if (panes[id].flat) {
          void refresh(id);
        } else {
          recompute(id);
        }
      }
    },
  );

  /** 離開目前資料夾前，保存下一頁／上一頁需要還原的位置。 */
  function navigationSnapshot(pane: PaneMeta): NavigationSnapshot {
    const visible = visibleRef(pane.id).value;
    const focused = visible[Math.min(Math.max(pane.focusedIndex, 0), visible.length - 1)];
    return {
      path: pane.currentPath,
      selectedPaths: [...pane.selected],
      focusedPath: focused?.path ?? null,
      focusedIndex: pane.focusedIndex,
      scrollTop: pane.scrollTop,
    };
  }

  /**
   * 清單串流完成後套用歷史位置。
   *
   * 項目在離開期間可能被刪除、改名或排序改變，所以選取以路徑重新對應到目前清單；
   * 對不上的部分安靜略過。焦點優先找回同一個項目，找不到才退回原本的列號。
   */
  function restoreNavigationSnapshot(pane: PaneMeta, snapshot: NavigationSnapshot) {
    const visible = visibleRef(pane.id).value;
    const byKey = new Map(visible.map((item) => [normalizeKey(item.path), item]));
    const selected = snapshot.selectedPaths
      .map((path) => byKey.get(normalizeKey(path))?.path)
      .filter((path): path is string => path !== undefined);
    pane.selected = [...new Set(selected)];

    let focusedIndex = snapshot.focusedPath
      ? visible.findIndex((item) => samePath(item.path, snapshot.focusedPath!))
      : -1;
    if (focusedIndex < 0) {
      focusedIndex = Math.min(
        Math.max(snapshot.focusedIndex, 0),
        Math.max(visible.length - 1, 0),
      );
    }
    pane.focusedIndex = focusedIndex;

    pane.scrollTop = Math.max(0, snapshot.scrollTop);
    pane.scrollRestore = { token: ++scrollRequestSequence, top: pane.scrollTop };
  }

  /** 載入資料夾內容；同一窗格的新請求會中止尚未結束的舊串流。 */
  async function load(
    id: PaneId,
    target: string,
    restore?: NavigationSnapshot,
  ): Promise<void> {
    const pane = panes[id];
    if (!pane) {
      return;
    }

    /*
     * 扁平化列舉在後端的阻塞執行緒上跑，前端的 AbortController 到不了那裡，所以換路徑
     * 時要另外請它停下來。只有「新的這一輪不是扁平化」時才在這裡取消：順序是
     * 取消 → 新請求，兩個 IPC 沒有先後保證，反過來的話會取消掉剛開始的新走訪
     * （新的扁平化走訪由後端自己換掉舊旗標，見 `core::flat` 與 `commands::fs`）。
     */
    if (!pane.flat) {
      void api.cancelFlatScan(id).catch(() => undefined);
    }

    // 換資料夾就先放掉舊的監控，載入成功後再掛上新的。
    stopWatch(id);
    controllers.get(id)?.abort();
    const local = new AbortController();
    controllers.set(id, local);

    pane.status = "loading";
    pane.error = null;
    pane.truncated = false;
    pane.skipped = 0;
    pane.selected = [];
    pane.focusedIndex = 0;
    pane.scrollTop = 0;
    pane.scrollRestore = null;
    entriesRef(id).value = [];
    triggerRef(entriesRef(id));
    recompute(id);

    try {
      const onEvent = (event: DirStreamEvent) => {
        if (local.signal.aborted) {
          return;
        }
        switch (event.type) {
          case "start":
            pane.currentPath = event.path;
            pane.currentName = event.name;
            pane.parentPath = event.parent;
            break;
          case "batch":
            // 窗格可能在串流途中被關閉；此時直接丟棄這一批。
            if (!entriesByPane.has(id)) {
              return;
            }
            entriesRef(id).value.push(...event.entries);
            triggerRef(entriesRef(id));
            recompute(id);
            break;
          case "done":
            pane.truncated = event.truncated;
            pane.skipped = event.skipped;
            pane.status = "ready";
            recompute(id);
            if (restore) {
              restoreNavigationSnapshot(pane, restore);
            }
            /*
             * 扁平化展示不掛目錄監控：`ReadDirectoryChangesW` 只看得到這一層，子資料夾裡
             * 的變動收不到，接了只會讓清單半新半舊，不如不接（F5 手動重新整理）。
             */
            if (!pane.flat) {
              startWatch(id, pane.currentPath);
            }
            break;
        }
      };

      if (pane.flat) {
        await api.listDirectoryFlat(target, settings.showHidden, id, onEvent, local.signal);
      } else {
        await api.listDirectory(target, onEvent, local.signal);
      }

      if (!local.signal.aborted && pane.status === "loading") {
        pane.status = "ready";
        recompute(id);
      }
    } catch (cause) {
      if (local.signal.aborted) {
        return;
      }
      pane.status = "error";
      pane.error = normalizeBackendError(cause);
    }
  }

  function navigate(id: PaneId, target: string): Promise<void> {
    const pane = panes[id];
    if (!pane) {
      return Promise.resolve();
    }
    // 使用者主動換位置＝離開檢視器；清單類的重新整理（例如剪貼簿完成後）不會關掉它。
    viewer.close(id);
    if (!target || target === pane.currentPath) {
      return refresh(id);
    }
    if (pane.currentPath) {
      pane.backStack = [...pane.backStack, navigationSnapshot(pane)];
      pane.forwardStack = [];
    }
    return load(id, target);
  }

  function goBack(id: PaneId): Promise<void> {
    const pane = panes[id];
    const target = pane?.backStack.at(-1);
    if (!pane || !target) {
      return Promise.resolve();
    }
    viewer.close(id);
    const current = navigationSnapshot(pane);
    pane.backStack = pane.backStack.slice(0, -1);
    pane.forwardStack = [...pane.forwardStack, current];
    return load(id, target.path, target);
  }

  function goForward(id: PaneId): Promise<void> {
    const pane = panes[id];
    const target = pane?.forwardStack.at(-1);
    if (!pane || !target) {
      return Promise.resolve();
    }
    viewer.close(id);
    const current = navigationSnapshot(pane);
    pane.forwardStack = pane.forwardStack.slice(0, -1);
    pane.backStack = [...pane.backStack, current];
    return load(id, target.path, target);
  }

  function goUp(id: PaneId): Promise<void> {
    const pane = panes[id];
    const target = pane?.parentPath ?? (pane?.currentPath ? parentOf(pane.currentPath) : null);
    return target ? navigate(id, target) : Promise.resolve();
  }

  function refresh(id: PaneId): Promise<void> {
    const pane = panes[id];
    return pane?.currentPath ? load(id, pane.currentPath) : Promise.resolve();
  }

  /** 檔案清單每次捲動時同步位置，供下一次返回時重建同一個視野。 */
  function setScrollTop(id: PaneId, value: number) {
    const pane = panes[id];
    if (pane && pane.scrollTop !== value) {
      pane.scrollTop = Math.max(0, value);
    }
  }

  function applySort(id: PaneId, key: SortKey) {
    const pane = panes[id];
    if (!pane) {
      return;
    }
    if (pane.sortKey === key) {
      pane.sortDirection = pane.sortDirection === "asc" ? "desc" : "asc";
    } else {
      pane.sortKey = key;
      pane.sortDirection = "asc";
    }
    recompute(id);
  }

  function select(id: PaneId, path: string, mode: "replace" | "toggle" | "range" = "replace") {
    const pane = panes[id];
    if (!pane) {
      return;
    }
    const visible = visibleRef(id).value;

    if (mode === "range") {
      const anchor = visible.findIndex((item) => item.path === pane.selected.at(-1));
      const target = visible.findIndex((item) => item.path === path);
      if (anchor === -1 || target === -1) {
        pane.selected = [path];
      } else {
        const [from, to] = anchor < target ? [anchor, target] : [target, anchor];
        pane.selected = visible.slice(from, to + 1).map((item) => item.path);
      }
    } else if (mode === "toggle") {
      pane.selected = pane.selected.includes(path)
        ? pane.selected.filter((item) => item !== path)
        : [...pane.selected, path];
    } else {
      pane.selected = [path];
    }

    const index = visible.findIndex((item) => item.path === path);
    if (index >= 0) {
      pane.focusedIndex = index;
    }
  }

  function selectAll(id: PaneId) {
    const pane = panes[id];
    if (pane) {
      pane.selected = visibleRef(id).value.map((item) => item.path);
    }
  }

  /**
   * 以索引範圍選取（拖曳選取與框選用）。
   * `additive` 為 true 時併入現有選取（Ctrl 拖曳）。
   */
  function selectRange(id: PaneId, fromIndex: number, toIndex: number, additive = false) {
    const pane = panes[id];
    if (!pane) {
      return;
    }
    const visible = visibleRef(id).value;
    if (visible.length === 0) {
      return;
    }

    const [from, to] =
      fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
    const range = visible
      .slice(Math.max(0, from), Math.min(visible.length - 1, to) + 1)
      .map((item) => item.path);

    pane.selected = additive
      ? [...new Set([...pane.selected, ...range])]
      : range;
    pane.focusedIndex = Math.min(Math.max(toIndex, 0), visible.length - 1);
  }

  function clearSelection(id: PaneId) {
    const pane = panes[id];
    if (pane) {
      pane.selected = [];
    }
  }

  function focusAt(id: PaneId, index: number) {
    const pane = panes[id];
    if (!pane) {
      return;
    }
    const total = visibleRef(id).value.length;
    pane.focusedIndex = total === 0 ? 0 : Math.min(Math.max(index, 0), total - 1);
  }

  function moveFocus(id: PaneId, delta: number) {
    const pane = panes[id];
    if (pane) {
      focusAt(id, pane.focusedIndex + delta);
    }
  }

  function focusedEntry(id: PaneId): FileEntry | null {
    const pane = panes[id];
    if (!pane) {
      return null;
    }
    const visible = visibleRef(id).value;
    return visible[Math.min(pane.focusedIndex, visible.length - 1)] ?? null;
  }

  function selectionSummary(id: PaneId): { count: number; size: number } {
    const pane = panes[id];
    if (!pane || pane.selected.length === 0) {
      return { count: 0, size: 0 };
    }
    const chosen = new Set(pane.selected);
    let size = 0;
    for (const item of visibleRef(id).value) {
      if (chosen.has(item.path)) {
        size += item.size;
      }
    }
    return { count: pane.selected.length, size };
  }

  /** 雙擊或 Enter：資料夾進入、檔案以預設程式開啟。 */
  async function activate(id: PaneId, entry: FileEntry | null): Promise<void> {
    if (!entry) {
      return;
    }
    if (entry.isDir) {
      const pane = panes[id];
      if (pane) {
        pane.query = "";
        recompute(id);
      }
      await navigate(id, entry.path);
      return;
    }
    await openPath(entry.path);
  }

  async function openPath(path: string): Promise<void> {
    try {
      await api.openPath(path);
    } catch (cause) {
      ui.showNotice(normalizeBackendError(cause).message);
    }
  }

  async function reveal(entry: FileEntry): Promise<void> {
    try {
      await api.revealPath(entry.path);
    } catch (cause) {
      ui.showNotice(normalizeBackendError(cause).message);
    }
  }

  /** 只知道路徑時的「在檔案總管中顯示」（樹狀節點與空白處右鍵選單用）。 */
  async function revealTarget(path: string): Promise<void> {
    try {
      await api.revealPath(path);
    } catch (cause) {
      ui.showNotice(normalizeBackendError(cause).message);
    }
  }

  async function copyPath(path: string, format: "windows" | "linux" = "windows"): Promise<void> {
    const text = format === "linux" ? toUnixPath(path) : path;
    const copied = await copyText(text);
    ui.showNotice(copied ? "已複製路徑" : "無法複製到剪貼簿");
  }

  /** 一次複製多個路徑（一行一個），多選時用。 */
  async function copyPaths(
    paths: string[],
    format: "windows" | "linux" = "windows",
  ): Promise<void> {
    if (!paths.length) {
      return;
    }
    const convert = (path: string) => (format === "linux" ? toUnixPath(path) : path);
    const copied = await copyText(paths.map(convert).join("\r\n"));
    const what = paths.length === 1 ? "已複製路徑" : `已複製 ${paths.length} 個路徑`;
    ui.showNotice(copied ? what : "無法複製到剪貼簿");
  }

  /** 一次複製多個名稱（一行一個），多選時用。 */
  async function copyNames(paths: string[]): Promise<void> {
    if (!paths.length) {
      return;
    }
    const copied = await copyText(paths.map(fileNameOf).join("\r\n"));
    const what = paths.length === 1 ? "已複製名稱" : `已複製 ${paths.length} 個名稱`;
    ui.showNotice(copied ? what : "無法複製到剪貼簿");
  }

  /**
   * 定位用：目前選取項目所在的資料夾。
   *
   * 選到資料夾就回傳它本身；選到檔案則回傳它的父目錄；
   * 沒有選取任何東西時，回傳這個窗格目前所在的資料夾。
   */
  function locateDirectory(id: PaneId): string {
    const pane = panes[id];
    if (!pane) {
      return "";
    }
    const last = pane.selected.at(-1);
    if (!last) {
      return pane.currentPath;
    }
    const entry = visibleRef(id).value.find((item) => item.path === last);
    if (!entry) {
      return last;
    }
    return entry.isDir ? entry.path : (parentOf(entry.path) ?? pane.currentPath);
  }

  /** 目前選取項目；沒有選取任何東西時，就是這個窗格所在的資料夾。 */
  function selectionTarget(id: PaneId): { path: string; isDir: boolean } | null {
    const pane = panes[id];
    if (!pane) {
      return null;
    }
    const last = pane.selected.at(-1);
    if (!last) {
      return pane.currentPath ? { path: pane.currentPath, isDir: true } : null;
    }
    const entry = visibleRef(id).value.find((item) => item.path === last);
    return entry ? { path: entry.path, isDir: entry.isDir } : { path: last, isDir: false };
  }

  /**
   * 目前選取的全部項目，依選取順序。
   *
   * 清單被搜尋或隱藏項目篩過時，選取中的項目可能不在畫面上；那種情況只能
   * 假設它是檔案（與 `selectionTarget` 的退路一致）。
   */
  function selectionTargets(id: PaneId): { path: string; isDir: boolean }[] {
    const pane = panes[id];
    if (!pane?.selected.length) {
      return [];
    }
    const entries = visibleRef(id).value;
    return pane.selected.map((path) => ({
      path,
      isDir: entries.find((item) => item.path === path)?.isDir ?? false,
    }));
  }

  function dismissError(id: PaneId) {
    const pane = panes[id];
    if (pane) {
      pane.error = null;
    }
  }

  /**
   * 建立資料夾或空檔案。
   *
   * 建立的位置不一定等於這個窗格目前顯示的資料夾（右鍵在子資料夾上時），
   * 只有在兩者相同時才重讀清單並選取新項目 —— 否則使用者的畫面不該被拉走。
   */
  async function createEntry(
    id: PaneId,
    parent: string,
    name: string,
    kind: "folder" | "file",
  ): Promise<boolean> {
    const pane = panes[id];
    if (!pane) {
      return false;
    }
    try {
      const created =
        kind === "folder"
          ? await api.createFolder(parent, name)
          : await api.createFile(parent, name);

      if (samePath(parent, pane.currentPath)) {
        await refresh(id);
        // 用清單裡的實際路徑選取：後端回傳的路徑大小寫可能與列舉結果不同。
        const list = visibleRef(id).value;
        const index = list.findIndex((item) => samePath(item.path, created));
        pane.selected = index >= 0 ? [list[index].path] : [created];
        if (index >= 0) {
          pane.focusedIndex = index;
        }
      }
      ui.showNotice(kind === "folder" ? `已建立資料夾「${name}」` : `已建立檔案「${name}」`);
      return true;
    } catch (cause) {
      pane.error = normalizeBackendError(cause);
      return false;
    }
  }

  function columnWidth(id: PaneId, column: ColumnId): number {
    return panes[id]?.columnWidths[column] ?? COLUMN_DEFAULTS[column];
  }

  function setColumnWidth(id: PaneId, column: ColumnId, width: number) {
    const pane = panes[id];
    if (!pane) {
      return;
    }
    const next = Math.max(Math.round(width), COLUMN_MIN[column]);
    if (pane.columnWidths[column] === next) {
      return;
    }
    pane.columnWidths = { ...pane.columnWidths, [column]: next };
  }

  function resetColumnWidth(id: PaneId, column: ColumnId) {
    const pane = panes[id];
    if (pane) {
      pane.columnWidths = { ...pane.columnWidths, [column]: COLUMN_DEFAULTS[column] };
    }
  }

  /** 把所有窗格的欄寬，連同新窗格的預設值一起回復原廠。 */
  function resetAllColumnWidths() {
    settings.resetColumnWidths();
    for (const id of Object.keys(panes)) {
      panes[id].columnWidths = { ...COLUMN_DEFAULTS };
    }
  }

  function setQuery(id: PaneId, value: string) {
    const pane = panes[id];
    if (pane) {
      pane.query = value;
      recompute(id);
    }
  }

  /**
   * 切換扁平化展示。
   *
   * 兩邊的清單內容完全不同（一層 vs. 整棵子樹），所以直接重讀這條路徑 —— 重新讀取也會
   * 清掉選取，這正是使用者預期的（原本選到的項目可能根本不在新清單裡）。
   */
  function setFlat(id: PaneId, value: boolean) {
    const pane = panes[id];
    if (!pane || pane.flat === value) {
      return;
    }
    pane.flat = value;
    if (pane.currentPath) {
      void load(id, pane.currentPath);
    }
  }

  return {
    createPane,
    destroyPane,
    visibleRef,
    entries,
    meta,
    load,
    navigate,
    goBack,
    goForward,
    goUp,
    refresh,
    setScrollTop,
    applySort,
    select,
    selectAll,
    selectRange,
    clearSelection,
    focusAt,
    moveFocus,
    focusedEntry,
    selectionSummary,
    activate,
    openPath,
    reveal,
    revealTarget,
    copyPath,
    copyPaths,
    copyNames,
    locateDirectory,
    selectionTarget,
    selectionTargets,
    dismissError,
    createEntry,
    columnWidth,
    setColumnWidth,
    resetColumnWidth,
    resetAllColumnWidths,
    setQuery,
    setFlat,
  };
});

// setup store 內有非響應式快取（項目陣列、AbortController、子節點快取），
// 熱更新無法安全接手，整頁重載才能保證狀態一致；工作階段會從 localStorage 還原。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
