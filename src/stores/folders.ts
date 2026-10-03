import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import * as api from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { STORAGE_KEYS, readJson, writeJson } from "@/services/storage";
import type { FileEntry, FolderRoot } from "@/types/fs";
import { fileNameOf, normalizeKey } from "@/utils/path";
import { useUiStore } from "@/stores/ui";

interface StoredFolders {
  roots: FolderRoot[];
  expanded: string[];
}

const EMPTY: StoredFolders = { roots: [], expanded: [] };

/**
 * 「我的資料夾」：使用者自己挑選的工作資料夾根，以及它們的樹狀展開狀態。
 *
 * 只處理資料夾（`list_subdirs`），子節點採懶載入 —— 展開誰才讀誰。
 */
export const useFoldersStore = defineStore("folders", () => {
  const ui = useUiStore();
  const stored = readJson<StoredFolders>(STORAGE_KEYS.folders, EMPTY, (value) => {
    const candidate = value as StoredFolders;
    return !!candidate && Array.isArray(candidate.roots) && Array.isArray(candidate.expanded);
  });

  const roots = ref<FolderRoot[]>(stored.roots);
  const expanded = ref<string[]>(stored.expanded);
  /** 節點路徑（正規化鍵）→ 子資料夾。 */
  const children = ref<Record<string, FileEntry[]>>({});
  const loading = ref<Record<string, boolean>>({});
  /** 樹狀清單中目前被選取的節點（供「移除資料夾」使用）。 */
  const activePath = ref("");

  const isEmpty = computed(() => roots.value.length === 0);

  watch(
    [roots, expanded],
    () => writeJson(STORAGE_KEYS.folders, { roots: roots.value, expanded: expanded.value }),
    { deep: true },
  );

  /** 加入一個資料夾根；已存在時回傳 `false`（呼叫端據此提示）。 */
  function addRoot(path: string): boolean {
    const key = normalizeKey(path);
    if (!path || roots.value.some((root) => normalizeKey(root.path) === key)) {
      return false;
    }
    const root: FolderRoot = {
      id: `root-${Date.now().toString(36)}`,
      path,
      label: fileNameOf(path) || path,
    };
    roots.value = [...roots.value, root];
    expanded.value = [...expanded.value, key];
    void loadChildren(path);
    return true;
  }

  function removeRoot(id: string): FolderRoot | null {
    const target = roots.value.find((root) => root.id === id) ?? null;
    if (!target) {
      return null;
    }
    roots.value = roots.value.filter((root) => root.id !== id);
    return target;
  }

  /** 復原用：把移除的資料夾插回原本的位置。 */
  function insertRoot(root: FolderRoot, index: number) {
    const next = [...roots.value];
    next.splice(Math.min(Math.max(index, 0), next.length), 0, root);
    roots.value = next;
  }

  /**
   * 拖曳排序：把第 `from` 個資料夾搬到第 `to` 個位置。
   *
   * 清單順序就是使用者自己決定的順序（存檔即所見），所以搬動後直接寫回 `roots`，
   * 由既有的 watch 負責持久化。
   */
  function moveRoot(from: number, to: number) {
    if (from === to || from < 0 || from >= roots.value.length) {
      return;
    }
    const next = [...roots.value];
    const [moved] = next.splice(from, 1);
    if (!moved) {
      return;
    }
    next.splice(Math.min(Math.max(to, 0), next.length), 0, moved);
    roots.value = next;
  }

  function rootIndexOf(id: string): number {
    return roots.value.findIndex((root) => root.id === id);
  }

  /**
   * 依名稱排序（A→Z）。
   *
   * 用 `Intl.Collator` 而不是字串比較：中文照 `zh-Hant` 的排序規則，
   * 而且 `numeric` 讓「資料夾 2」排在「資料夾 10」前面。
   * 排完之後仍然是同一份可拖曳的清單 —— 想微調再自己拉。
   */
  function sortRootsByName() {
    const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });
    roots.value = [...roots.value].sort((a, b) => collator.compare(a.label, b.label));
  }

  function setActivePath(path: string) {
    activePath.value = path;
  }

  /** 找出目前選取節點所屬的資料夾根。 */
  function activeRoot(): FolderRoot | null {
    return rootFor(activePath.value);
  }

  /** 找出某個路徑落在哪一個資料夾根底下。 */
  function rootFor(path: string): FolderRoot | null {
    if (!path) {
      return null;
    }
    const key = normalizeKey(path);
    return (
      roots.value.find((root) => {
        const rootKey = normalizeKey(root.path);
        return key === rootKey || key.startsWith(`${rootKey}\\`);
      }) ?? null
    );
  }

  function isExpanded(path: string): boolean {
    const key = normalizeKey(path);
    return expanded.value.some((value) => normalizeKey(value) === key);
  }

  /** 展開狀態存的是原始路徑，比對時才正規化 —— 重新整理時要能直接拿來重讀。 */
  function setExpanded(path: string, open: boolean) {
    const key = normalizeKey(path);
    const rest = expanded.value.filter((value) => normalizeKey(value) !== key);
    expanded.value = open ? [...rest, path] : rest;
  }

  async function toggle(path: string) {
    const key = normalizeKey(path);
    if (isExpanded(path)) {
      setExpanded(path, false);
      // 收合時順手丟掉快取：下次展開會重新讀取，樹就不會一直是舊的。
      if (children.value[key]) {
        const next = { ...children.value };
        delete next[key];
        children.value = next;
      }
      return;
    }
    setExpanded(path, true);
    await loadChildren(path);
  }

  /** 重新整理：丟掉所有快取，重新讀取資料夾根與目前展開的節點。 */
  async function refresh() {
    children.value = {};
    const targets = [...roots.value.map((root) => root.path), ...expanded.value];
    await Promise.all(targets.map((path) => loadChildren(path)));
  }

  async function loadChildren(path: string) {
    const key = normalizeKey(path);
    if (children.value[key] || loading.value[key]) {
      return;
    }
    loading.value = { ...loading.value, [key]: true };
    try {
      const list = await api.listSubdirs(path);
      children.value = { ...children.value, [key]: list };
    } catch (cause) {
      // 展開失敗要講出來，不能讓樹默默地停在舊狀態。
      ui.showNotice(normalizeBackendError(cause).message, undefined, 4000);
      children.value = { ...children.value, [key]: [] };
    } finally {
      const next = { ...loading.value };
      delete next[key];
      loading.value = next;
    }
  }

  function childrenOf(path: string): FileEntry[] {
    return children.value[normalizeKey(path)] ?? [];
  }

  function isLoading(path: string): boolean {
    return !!loading.value[normalizeKey(path)];
  }

  /** 收合：只收合節點，不動資料夾清單本身。 */
  function collapseAll() {
    expanded.value = [];
  }

  /** 把目前路徑所在的節點自動展開（空間一致性：東西從哪來，就在哪發光）。 */
  async function reveal(path: string, rootPath: string) {
    if (!path || !rootPath || !normalizeKey(path).startsWith(normalizeKey(rootPath))) {
      return;
    }
    /*
     * 根自己也要展開。這裡只展開「中間層」的話，「收合全部」（或上次關閉時
     * 根是收合的）之後再定位，中間層雖然被展開，整串卻藏在收合的根底下，
     * 看起來就像定位沒反應。
     */
    setExpanded(rootPath, true);
    await loadChildren(rootPath);

    const parts = path.slice(rootPath.length).split("\\").filter(Boolean);

    let current = rootPath;
    for (const part of parts.slice(0, -1)) {
      current = `${current.replace(/\\+$/, "")}\\${part}`;
      setExpanded(current, true);
      await loadChildren(current);
    }
  }

  return {
    roots,
    expanded,
    children,
    loading,
    activePath,
    isEmpty,
    addRoot,
    removeRoot,
    insertRoot,
    moveRoot,
    rootIndexOf,
    sortRootsByName,
    setActivePath,
    activeRoot,
    rootFor,
    isExpanded,
    toggle,
    loadChildren,
    childrenOf,
    isLoading,
    collapseAll,
    refresh,
    reveal,
  };
});

// setup store 內有非響應式快取（項目陣列、AbortController、子節點快取），
// 熱更新無法安全接手，整頁重載才能保證狀態一致；工作階段會從 localStorage 還原。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
