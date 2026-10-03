import { defineStore } from "pinia";
import { computed, ref, watch, watchEffect } from "vue";
import { STORAGE_KEYS, readJson, writeJson } from "@/services/storage";
import type { ColumnId, SortDirection, SortKey } from "@/types/fs";

export type ThemeMode = "light" | "dark" | "system";
export type MotionPreference = "full" | "system" | "reduced";
export type TerminalChoice = "powershell" | "cmd";

export const ALL_COLUMNS: { id: ColumnId; label: string; sortable: SortKey | null; align?: "end" }[] = [
  { id: "name", label: "名稱", sortable: "name" },
  { id: "kind", label: "類型", sortable: "kind" },
  { id: "size", label: "大小", sortable: "size", align: "end" },
  { id: "modified", label: "修改日期", sortable: "modified" },
  { id: "created", label: "建立日期", sortable: "created" },
  { id: "attributes", label: "屬性", sortable: null },
  { id: "path", label: "路徑", sortable: null },
];

/** 欄位預設寬度（px）。名稱與路徑給得寬一點，因為最容易需要看完整內容。 */
export const COLUMN_DEFAULTS: Record<ColumnId, number> = {
  name: 280,
  kind: 150,
  size: 110,
  modified: 165,
  created: 165,
  attributes: 110,
  path: 300,
};

/** 欄位最小寬度：拖曳不會把欄位壓到看不見。 */
export const COLUMN_MIN: Record<ColumnId, number> = {
  name: 120,
  kind: 72,
  size: 72,
  modified: 96,
  created: 96,
  attributes: 80,
  path: 140,
};

export const TREE_MIN_WIDTH = 168;
export const TREE_MAX_WIDTH = 460;

interface StoredSettings {
  themeMode: ThemeMode;
  showHidden: boolean;
  columns: ColumnId[];
  columnWidths: Record<string, number>;
  defaultSortKey: SortKey;
  defaultSortDirection: SortDirection;
  motion: MotionPreference;
  restoreSession: boolean;
  terminal: TerminalChoice;
  notepadppPath: string;
  vscodePath: string;
  treeWidth: number;
  treeCollapsed: boolean;
}

const DEFAULTS: StoredSettings = {
  themeMode: "system",
  showHidden: false,
  columns: ["name", "kind", "size", "modified"],
  columnWidths: { ...COLUMN_DEFAULTS },
  defaultSortKey: "name",
  defaultSortDirection: "asc",
  motion: "system",
  restoreSession: true,
  terminal: "powershell",
  notepadppPath: "",
  vscodePath: "",
  treeWidth: 260,
  treeCollapsed: false,
};

const COLUMN_IDS = new Set<string>(ALL_COLUMNS.map((column) => column.id));

function sanitize(raw: Partial<StoredSettings>): StoredSettings {
  const columns = Array.isArray(raw.columns)
    ? raw.columns.filter((id): id is ColumnId => COLUMN_IDS.has(id))
    : [];

  return {
    ...DEFAULTS,
    ...raw,
    columns: columns.length ? columns : DEFAULTS.columns,
  };
}

/** 使用者偏好設定的唯一真實來源，任何變更都會立刻反映到 DOM 與持久化。 */
export const useSettingsStore = defineStore("settings", () => {
  const stored = sanitize(
    readJson<Partial<StoredSettings>>(STORAGE_KEYS.settings, {}, (value) => typeof value === "object"),
  );

  const themeMode = ref<ThemeMode>(stored.themeMode);
  const showHidden = ref(stored.showHidden);
  const columns = ref<ColumnId[]>(stored.columns);
  const columnWidths = ref<Record<string, number>>({
    ...COLUMN_DEFAULTS,
    ...(stored.columnWidths ?? {}),
  });
  const defaultSortKey = ref<SortKey>(stored.defaultSortKey);
  const defaultSortDirection = ref<SortDirection>(stored.defaultSortDirection);
  const motion = ref<MotionPreference>(stored.motion);
  const restoreSession = ref(stored.restoreSession);
  const terminal = ref<TerminalChoice>(stored.terminal);
  const notepadppPath = ref(stored.notepadppPath);
  const vscodePath = ref(stored.vscodePath);
  const treeWidth = ref(stored.treeWidth);
  const treeCollapsed = ref(stored.treeCollapsed);

  const prefersDark = ref(
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const prefersReducedMotion = ref(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  if (typeof window !== "undefined") {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
      prefersDark.value = event.matches;
    });
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (event) => {
      prefersReducedMotion.value = event.matches;
    });
  }

  const isDark = computed(() =>
    themeMode.value === "system" ? prefersDark.value : themeMode.value === "dark",
  );

  /** 動態效果是否該被抑制（系統偏好 + 使用者覆寫）。 */
  const reduceMotion = computed(
    () => motion.value === "reduced" || (motion.value === "system" && prefersReducedMotion.value),
  );

  watchEffect(() => {
    document.documentElement.classList.toggle("dark", isDark.value);
    document.documentElement.classList.toggle("reduce-motion", reduceMotion.value);
  });

  let persistTimer: ReturnType<typeof setTimeout> | undefined;

  // 拖曳欄寬時會高頻變動，寫入延後一點，避免每個 pointermove 都碰 localStorage。
  watch(
    [themeMode, showHidden, columns, columnWidths, defaultSortKey, defaultSortDirection, motion, restoreSession, terminal, notepadppPath, vscodePath, treeWidth, treeCollapsed],
    () => {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        writeJson(STORAGE_KEYS.settings, {
          themeMode: themeMode.value,
          showHidden: showHidden.value,
          columns: columns.value,
          columnWidths: columnWidths.value,
          defaultSortKey: defaultSortKey.value,
          defaultSortDirection: defaultSortDirection.value,
          motion: motion.value,
          restoreSession: restoreSession.value,
          terminal: terminal.value,
          notepadppPath: notepadppPath.value,
          vscodePath: vscodePath.value,
          treeWidth: treeWidth.value,
          treeCollapsed: treeCollapsed.value,
        } satisfies StoredSettings);
      }, 200);
    },
    { deep: true },
  );

  function toggleTheme() {
    themeMode.value = isDark.value ? "light" : "dark";
  }

  function toggleColumn(id: ColumnId) {
    const next = columns.value.includes(id)
      ? columns.value.filter((value) => value !== id)
      : [...columns.value, id];
    if (!next.includes("name")) {
      next.unshift("name");
    }
    columns.value = next;
  }

  function columnWidth(id: ColumnId): number {
    return columnWidths.value[id] ?? COLUMN_DEFAULTS[id];
  }

  function setColumnWidth(id: ColumnId, width: number) {
    const next = Math.max(Math.round(width), COLUMN_MIN[id]);
    if (columnWidths.value[id] === next) {
      return;
    }
    columnWidths.value = { ...columnWidths.value, [id]: next };
  }

  function resetColumnWidths() {
    columnWidths.value = { ...COLUMN_DEFAULTS };
  }

  function resetColumnWidth(id: ColumnId) {
    columnWidths.value = { ...columnWidths.value, [id]: COLUMN_DEFAULTS[id] };
  }

  /** 資料夾樹是整個分頁共用的一份，寬度與收合狀態因此也是全域的。 */
  function setTreeWidth(width: number) {
    treeWidth.value = Math.min(Math.max(Math.round(width), TREE_MIN_WIDTH), TREE_MAX_WIDTH);
  }

  function toggleTree() {
    treeCollapsed.value = !treeCollapsed.value;
  }

  return {
    themeMode,
    showHidden,
    columns,
    columnWidths,
    defaultSortKey,
    defaultSortDirection,
    motion,
    restoreSession,
    terminal,
    notepadppPath,
    vscodePath,
    treeWidth,
    treeCollapsed,
    isDark,
    reduceMotion,
    prefersReducedMotion,
    toggleTheme,
    toggleColumn,
    columnWidth,
    setColumnWidth,
    resetColumnWidth,
    resetColumnWidths,
    setTreeWidth,
    toggleTree,
  };
});

// 開發時熱更新會替換模組，Pinia 需要明確接手，否則既有 store 實例會失效。
// setup store 內有非響應式快取（項目陣列、AbortController、子節點快取），
// 熱更新無法安全接手，整頁重載才能保證狀態一致；工作階段會從 localStorage 還原。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
