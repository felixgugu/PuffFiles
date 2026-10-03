import { defineStore } from "pinia";
import { reactive, shallowRef, triggerRef, watch, type ShallowRef } from "vue";
import * as api from "@/services/api";
import { copyText } from "@/services/clipboard";
import { normalizeBackendError, type AppErrorView } from "@/services/errors";
import { useHistoryStore } from "@/stores/history";
import { COLUMN_DEFAULTS, COLUMN_MIN, useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import type { ColumnId, FileEntry, PaneId, SortDirection, SortKey } from "@/types/fs";
import { kindLabel } from "@/utils/fileKind";
import { parentOf, toUnixPath } from "@/utils/path";

export type ExplorerStatus = "idle" | "loading" | "ready" | "error";

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
  backStack: string[];
  forwardStack: string[];
  truncated: boolean;
  total: number;
  /** 這個窗格自己的欄位寬度；兩個窗格互不影響。 */
  columnWidths: Record<string, number>;
}

const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });

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
  const history = useHistoryStore();

  const panes = reactive<Record<PaneId, PaneMeta>>({});
  const entriesByPane = new Map<PaneId, ShallowRef<FileEntry[]>>();
  const visibleByPane = new Map<PaneId, ShallowRef<FileEntry[]>>();
  const controllers = new Map<PaneId, AbortController>();
  let sequence = 0;

  function entriesRef(id: PaneId): ShallowRef<FileEntry[]> {
    return entriesByPane.get(id)!;
  }

  function visibleRef(id: PaneId): ShallowRef<FileEntry[]> {
    return visibleByPane.get(id)!;
  }

  function meta(id: PaneId): PaneMeta | undefined {
    return panes[id];
  }

  function createPane(initialPath = "", widths?: Record<string, number>): PaneId {
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
    entriesByPane.delete(id);
    visibleByPane.delete(id);
    delete panes[id];
  }

  function compare(a: FileEntry, b: FileEntry, key: SortKey, direction: SortDirection): number {
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
    const next: FileEntry[] = [];

    for (const item of source) {
      if (!settings.showHidden && item.isHidden) {
        continue;
      }
      if (keyword && !item.name.toLocaleLowerCase().includes(keyword)) {
        continue;
      }
      next.push(item);
    }

    if (!backendSorted && (pane.status !== "loading" || source.length <= EAGER_SORT_LIMIT)) {
      next.sort((a, b) => compare(a, b, pane.sortKey, pane.sortDirection));
    }

    target.value = next;
    pane.total = source.length;
    if (pane.focusedIndex >= next.length) {
      pane.focusedIndex = Math.max(0, next.length - 1);
    }
  }

  function recomputeAll() {
    for (const id of Object.keys(panes)) {
      recompute(id);
    }
  }

  // 顯示隱藏項目的偏好是全域的，切換時所有窗格一起重算。
  watch(() => settings.showHidden, recomputeAll);

  /** 載入資料夾內容；同一窗格的新請求會中止尚未結束的舊串流。 */
  async function load(id: PaneId, target: string): Promise<void> {
    const pane = panes[id];
    if (!pane) {
      return;
    }

    controllers.get(id)?.abort();
    const local = new AbortController();
    controllers.set(id, local);

    pane.status = "loading";
    pane.error = null;
    pane.truncated = false;
    pane.selected = [];
    pane.focusedIndex = 0;
    entriesRef(id).value = [];
    triggerRef(entriesRef(id));
    recompute(id);

    try {
      await api.listDirectory(
        target,
        (event) => {
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
              pane.status = "ready";
              recompute(id);
              history.record(pane.currentPath, pane.currentName);
              break;
          }
        },
        local.signal,
      );

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
    if (!target || target === pane.currentPath) {
      return refresh(id);
    }
    if (pane.currentPath) {
      pane.backStack = [...pane.backStack, pane.currentPath];
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
    pane.backStack = pane.backStack.slice(0, -1);
    pane.forwardStack = [...pane.forwardStack, pane.currentPath];
    return load(id, target);
  }

  function goForward(id: PaneId): Promise<void> {
    const pane = panes[id];
    const target = pane?.forwardStack.at(-1);
    if (!pane || !target) {
      return Promise.resolve();
    }
    pane.forwardStack = pane.forwardStack.slice(0, -1);
    pane.backStack = [...pane.backStack, pane.currentPath];
    return load(id, target);
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

  function dismissError(id: PaneId) {
    const pane = panes[id];
    if (pane) {
      pane.error = null;
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

  return {
    createPane,
    destroyPane,
    visibleRef,
    meta,
    load,
    navigate,
    goBack,
    goForward,
    goUp,
    refresh,
    applySort,
    select,
    selectAll,
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
    locateDirectory,
    selectionTarget,
    dismissError,
    columnWidth,
    setColumnWidth,
    resetColumnWidth,
    resetAllColumnWidths,
    setQuery,
  };
});

// setup store 內有非響應式快取（項目陣列、AbortController、子節點快取），
// 熱更新無法安全接手，整頁重載才能保證狀態一致；工作階段會從 localStorage 還原。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
