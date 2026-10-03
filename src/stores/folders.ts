import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import * as api from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { STORAGE_KEYS, readJson, writeJson } from "@/services/storage";
import type { FileEntry, FolderNode } from "@/types/fs";
import { fileNameOf, normalizeKey } from "@/utils/path";
import { useUiStore } from "@/stores/ui";

interface StoredFolders {
  roots: FolderNode[];
  /** 真實資料夾的展開狀態（存路徑）。 */
  expanded: string[];
  /** 虛擬目錄的展開狀態（存節點 id）。 */
  expandedGroups: string[];
}

const EMPTY: StoredFolders = { roots: [], expanded: [], expandedGroups: [] };

/** 第一層的容器 id；其他容器的 id 就是那個虛擬目錄的節點 id。 */
export const TREE_ROOT_CONTAINER = "";

/** 記下節點原本的位置，「復原」才知道要放回哪裡。 */
export interface RemovedNode {
  node: FolderNode;
  containerId: string;
  index: number;
}

/** 樹上的節點 + 它在哪個容器、容器中的第幾個。 */
interface TreeNodeRef {
  node: FolderNode;
  containerId: string;
  index: number;
}

let idSeq = 0;

/** 節點 id：真實資料夾 `root-…`、虛擬目錄 `group-…`，同一毫秒連續建立也不會撞號。 */
function nextId(prefix: "root" | "group"): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq.toString(36)}`;
}

/**
 * 讀進來的資料可能是舊格式（沒有 `kind`、沒有 id）——那時它一定是真實資料夾，
 * 補上現在的形狀就好，不必另外寫一支遷移程式。
 */
function normalizeNode(raw: Partial<FolderNode> | null | undefined): FolderNode | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const id = typeof raw.id === "string" && raw.id ? raw.id : "";
  const label = typeof raw.label === "string" ? raw.label : "";

  if (raw.kind === "group") {
    const children = Array.isArray(raw.children)
      ? raw.children
          .map(normalizeNode)
          .filter((child): child is FolderNode => !!child && child.kind === "folder")
      : [];
    return { id: id || nextId("group"), label: label || "虛擬目錄", kind: "group", children };
  }

  const path = typeof raw.path === "string" ? raw.path : "";
  if (!path) {
    return null;
  }
  return { id: id || nextId("root"), label: label || fileNameOf(path) || path, kind: "folder", path };
}

/**
 * 「我的資料夾」：使用者自己挑選的工作資料夾，以及它們的樹狀展開狀態。
 *
 * 第一層可以混搭真實資料夾與「虛擬目錄」（純分組、沒有實體路徑）；虛擬目錄裡
 * 只能是真實資料夾，也就是最多兩層。只處理資料夾（`list_subdirs`），子節點
 * 懶載入 —— 展開誰才讀誰。
 */
export const useFoldersStore = defineStore("folders", () => {
  const ui = useUiStore();
  const stored = readJson<StoredFolders>(STORAGE_KEYS.folders, EMPTY, (value) => {
    const candidate = value as StoredFolders;
    return !!candidate && Array.isArray(candidate.roots) && Array.isArray(candidate.expanded);
  });

  const roots = ref<FolderNode[]>(
    (stored.roots ?? []).map(normalizeNode).filter((node): node is FolderNode => node !== null),
  );
  const expanded = ref<string[]>(stored.expanded ?? []);
  const expandedGroups = ref<string[]>(
    Array.isArray(stored.expandedGroups) ? stored.expandedGroups : [],
  );
  /** 資料夾路徑（正規化鍵）→ 子資料夾。 */
  const children = ref<Record<string, FileEntry[]>>({});
  const loading = ref<Record<string, boolean>>({});
  /**
   * 樹上被選取的節點。
   *
   * 虛擬目錄沒有路徑，所以一律用節點 id；檔案系統的子資料夾不在清單上、沒有 id，
   * 就用它的路徑當鍵（路徑不可能與 `root-…`／`group-…` 撞號）。
   */
  const activeId = ref<string | null>(null);

  const isEmpty = computed(() => roots.value.length === 0);

  watch(
    [roots, expanded, expandedGroups],
    () =>
      writeJson(STORAGE_KEYS.folders, {
        roots: roots.value,
        expanded: expanded.value,
        expandedGroups: expandedGroups.value,
      }),
    { deep: true },
  );

  /* -------------------------------------------------------------------------
   * 查詢
   * ---------------------------------------------------------------------- */

  /** 攤平整棵樹（含虛擬目錄裡的項目），附帶容器與索引。 */
  function treeRefs(): TreeNodeRef[] {
    const refs: TreeNodeRef[] = [];
    const walk = (list: FolderNode[], containerId: string) => {
      list.forEach((node, index) => {
        refs.push({ node, containerId, index });
        if (node.kind === "group" && node.children) {
          walk(node.children, node.id);
        }
      });
    };
    walk(roots.value, TREE_ROOT_CONTAINER);
    return refs;
  }

  function nodeById(id: string | null): FolderNode | null {
    if (!id) {
      return null;
    }
    return treeRefs().find((ref) => ref.node.id === id)?.node ?? null;
  }

  /** 樹上所有真實資料夾（含虛擬目錄裡的）。 */
  function folderNodes(): FolderNode[] {
    return treeRefs()
      .filter((ref) => ref.node.kind === "folder")
      .map((ref) => ref.node);
  }

  /** 第一層的虛擬目錄。 */
  function groupNodes(): FolderNode[] {
    return roots.value.filter((node) => node.kind === "group");
  }

  /** 節點放在哪個容器；不在樹上時回傳 `null`，第一層是空字串。 */
  function containerIdOf(id: string): string | null {
    return treeRefs().find((ref) => ref.node.id === id)?.containerId ?? null;
  }

  function nodesIn(containerId: string): FolderNode[] {
    if (!containerId) {
      return roots.value;
    }
    const group = nodeById(containerId);
    return group?.kind === "group" ? (group.children ?? []) : [];
  }

  function updateContainer(containerId: string, next: FolderNode[]) {
    if (!containerId) {
      roots.value = next;
      return;
    }
    const group = nodeById(containerId);
    if (group?.kind === "group") {
      group.children = next;
    }
  }

  /** 找出某個路徑落在哪一個樹上的資料夾底下（多個符合時取最長、最精確的那個）。 */
  function folderNodeFor(path: string): FolderNode | null {
    if (!path) {
      return null;
    }
    const key = normalizeKey(path);
    let best: FolderNode | null = null;
    let bestLength = -1;
    for (const node of folderNodes()) {
      const nodeKey = normalizeKey(node.path ?? "");
      if (!nodeKey) {
        continue;
      }
      if (key !== nodeKey && !key.startsWith(`${nodeKey}\\`)) {
        continue;
      }
      if (nodeKey.length > bestLength) {
        best = node;
        bestLength = nodeKey.length;
      }
    }
    return best;
  }

  /* -------------------------------------------------------------------------
   * 選取
   * ---------------------------------------------------------------------- */

  function select(id: string | null) {
    activeId.value = id;
  }

  /** 由路徑回推節點並選取；路徑不在清單上（檔案系統子資料夾）時用路徑本身當鍵。 */
  function selectByPath(path: string) {
    if (!path) {
      return;
    }
    const key = normalizeKey(path);
    const node = folderNodes().find((item) => normalizeKey(item.path ?? "") === key);
    activeId.value = node?.id ?? path;
  }

  function selectedNode(): FolderNode | null {
    return nodeById(activeId.value);
  }

  /* -------------------------------------------------------------------------
   * 編輯清單
   * ---------------------------------------------------------------------- */

  /** 加入一個真實資料夾；已存在（全樹去重）時回傳 `false`。 */
  function addFolder(path: string, groupId = TREE_ROOT_CONTAINER): boolean {
    const key = normalizeKey(path);
    if (!path || folderNodes().some((node) => normalizeKey(node.path ?? "") === key)) {
      return false;
    }
    const node: FolderNode = {
      id: nextId("root"),
      label: fileNameOf(path) || path,
      kind: "folder",
      path,
    };
    const containerId = groupId && nodeById(groupId)?.kind === "group" ? groupId : TREE_ROOT_CONTAINER;
    updateContainer(containerId, [...nodesIn(containerId), node]);
    setPathExpanded(path, true);
    void loadChildren(path);
    return true;
  }

  /** 建立一個虛擬目錄（第一層、預設展開）。 */
  function addGroup(label: string): FolderNode {
    const group: FolderNode = {
      id: nextId("group"),
      label: label.trim() || "新增虛擬目錄",
      kind: "group",
      children: [],
    };
    roots.value = [...roots.value, group];
    setGroupExpanded(group.id, true);
    return group;
  }

  function renameNode(id: string, label: string): boolean {
    const node = nodeById(id);
    const trimmed = label.trim();
    if (!node || !trimmed) {
      return false;
    }
    node.label = trimmed;
    return true;
  }

  /** 從清單移除節點（不會動到實體檔案）；回傳的資訊供「復原」使用。 */
  function removeNode(id: string): RemovedNode | null {
    const ref = treeRefs().find((item) => item.node.id === id);
    if (!ref) {
      return null;
    }
    updateContainer(
      ref.containerId,
      nodesIn(ref.containerId).filter((node) => node.id !== id),
    );
    return { node: ref.node, containerId: ref.containerId, index: ref.index };
  }

  function insertNode(removed: RemovedNode) {
    const list = [...nodesIn(removed.containerId)];
    list.splice(Math.min(Math.max(removed.index, 0), list.length), 0, removed.node);
    updateContainer(removed.containerId, list);
    // 復原到虛擬目錄裡時順手打開它，不然看畫面會以為沒復原成功。
    setGroupExpanded(removed.containerId, true);
  }

  /** 拖曳排序：同一個容器內搬動（跨容器一律不搬）。 */
  function moveNode(containerId: string, from: number, to: number) {
    const list = nodesIn(containerId);
    if (from === to || from < 0 || from >= list.length) {
      return;
    }
    const next = [...list];
    const [moved] = next.splice(from, 1);
    if (!moved) {
      return;
    }
    next.splice(Math.min(Math.max(to, 0), next.length), 0, moved);
    updateContainer(containerId, next);
  }

  /** 把某個真實資料夾搬進虛擬目錄（右鍵選單用），搬到目標的尾端。 */
  function moveNodeToGroup(nodeId: string, groupId: string): boolean {
    const ref = treeRefs().find((item) => item.node.id === nodeId);
    const group = nodeById(groupId);
    if (!ref || ref.node.kind !== "folder" || group?.kind !== "group") {
      return false;
    }
    if (ref.containerId === groupId) {
      return false;
    }
    updateContainer(
      ref.containerId,
      nodesIn(ref.containerId).filter((node) => node.id !== nodeId),
    );
    updateContainer(groupId, [...nodesIn(groupId), ref.node]);
    setGroupExpanded(groupId, true);
    return true;
  }

  /**
   * 依名稱排序指定容器（第一層傳空字串）。
   *
   * 用 `Intl.Collator` 而不是字串比較：中文照 `zh-Hant` 的排序規則，
   * 而且 `numeric` 讓「資料夾 2」排在「資料夾 10」前面。
   */
  function sortNodes(containerId: string) {
    const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });
    updateContainer(
      containerId,
      [...nodesIn(containerId)].sort((a, b) => collator.compare(a.label, b.label)),
    );
  }

  /* -------------------------------------------------------------------------
   * 展開狀態
   * ---------------------------------------------------------------------- */

  function isPathExpanded(path: string): boolean {
    const key = normalizeKey(path);
    return expanded.value.some((value) => normalizeKey(value) === key);
  }

  /** 展開狀態存的是原始路徑，比對時才正規化 —— 重新整理時要能直接拿來重讀。 */
  function setPathExpanded(path: string, open: boolean) {
    const key = normalizeKey(path);
    const rest = expanded.value.filter((value) => normalizeKey(value) !== key);
    expanded.value = open ? [...rest, path] : rest;
  }

  function isGroupExpanded(id: string): boolean {
    return !!id && expandedGroups.value.includes(id);
  }

  function setGroupExpanded(id: string, open: boolean) {
    if (!id) {
      return;
    }
    const rest = expandedGroups.value.filter((value) => value !== id);
    expandedGroups.value = open ? [...rest, id] : rest;
  }

  /** 節點展開了沒：虛擬目錄看 id，真實資料夾看路徑。 */
  function isExpanded(node: FolderNode): boolean {
    return node.kind === "group" ? isGroupExpanded(node.id) : isPathExpanded(node.path ?? "");
  }

  async function toggle(node: FolderNode) {
    if (node.kind === "group") {
      setGroupExpanded(node.id, !isGroupExpanded(node.id));
      return;
    }
    const path = node.path ?? "";
    if (!path) {
      return;
    }
    const key = normalizeKey(path);
    if (isPathExpanded(path)) {
      setPathExpanded(path, false);
      // 收合時順手丟掉快取：下次展開會重新讀取，樹就不會一直是舊的。
      if (children.value[key]) {
        const next = { ...children.value };
        delete next[key];
        children.value = next;
      }
      return;
    }
    setPathExpanded(path, true);
    await loadChildren(path);
  }

  /** 收合：只收合節點，不動清單本身。 */
  function collapseAll() {
    expanded.value = [];
    expandedGroups.value = [];
  }

  async function loadChildren(path: string) {
    const key = normalizeKey(path);
    if (!path || children.value[key] || loading.value[key]) {
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

  /** 重新整理：丟掉所有快取，重新讀取樹上每個真實資料夾與目前展開的節點。 */
  async function refresh() {
    children.value = {};
    const paths = new Set<string>(expanded.value);
    folderNodes().forEach((node) => {
      if (node.path) {
        paths.add(node.path);
      }
    });
    await Promise.all([...paths].map((path) => loadChildren(path)));
  }

  /**
   * 把某個路徑展開到看得見（空間一致性：東西從哪來，就在哪發光）。
   *
   * 所在的虛擬目錄要先打開，否則整串會藏在收合的分組底下；根自己也要展開，
   * 不然「收合全部」之後再定位，中間層雖然被展開卻看不到。
   */
  async function reveal(path: string) {
    const node = folderNodeFor(path);
    const rootPath = node?.path ?? "";
    if (!path || !rootPath || !normalizeKey(path).startsWith(normalizeKey(rootPath))) {
      return;
    }
    if (node) {
      const containerId = containerIdOf(node.id);
      if (containerId) {
        setGroupExpanded(containerId, true);
      }
    }
    setPathExpanded(rootPath, true);
    await loadChildren(rootPath);

    const parts = path.slice(rootPath.length).split("\\").filter(Boolean);
    let current = rootPath;
    for (const part of parts.slice(0, -1)) {
      current = `${current.replace(/\\+$/, "")}\\${part}`;
      setPathExpanded(current, true);
      await loadChildren(current);
    }
  }

  return {
    roots,
    expanded,
    expandedGroups,
    children,
    loading,
    activeId,
    isEmpty,
    nodeById,
    folderNodes,
    groupNodes,
    containerIdOf,
    nodesIn,
    folderNodeFor,
    select,
    selectByPath,
    selectedNode,
    addFolder,
    addGroup,
    renameNode,
    removeNode,
    insertNode,
    moveNode,
    moveNodeToGroup,
    sortNodes,
    isExpanded,
    isGroupExpanded,
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
