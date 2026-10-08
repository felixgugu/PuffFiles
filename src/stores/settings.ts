import { defineStore } from "pinia";
import { computed, ref, watch, watchEffect } from "vue";
import { STORAGE_KEYS, readJson, writeJson } from "@/services/storage";
import type { ColumnId, SortDirection, SortKey, SplitDirection } from "@/types/fs";
import type { ExternalTool } from "@/types/tools";
import { FONT_SIZE_DEFAULT, clampFontSize, normalizeFontFamily } from "@/utils/font";
import { DEFAULT_ALIAS_TEMPLATE } from "@/utils/folders";
import {
  clampPanelMinWidth,
  clampPanelOpacity,
  PANEL_MIN_WIDTH_DEFAULT,
  PANEL_OPACITY_DEFAULT,
} from "@/utils/viewerPanel";

export { FONT_SIZE_MAX, FONT_SIZE_MIN } from "@/utils/font";

export type ThemeMode = "light" | "dark" | "system";
export type MotionPreference = "full" | "system" | "reduced";

/** 內建的外部工具：可以編輯內容，但不能刪除。 */
export const DEFAULT_TOOLS: ExternalTool[] = [
  {
    id: "builtin-powershell",
    label: "開啟至 PowerShell",
    executable: "powershell.exe",
    args: ["-NoExit"],
    workingDirectory: "$fullFolderPath",
    newConsole: true,
    targets: ["folder"],
    icon: "terminal",
    builtin: true,
  },
  {
    id: "builtin-cmd",
    label: "開啟至命令提示字元",
    executable: "cmd.exe",
    args: ["/K"],
    workingDirectory: "$fullFolderPath",
    newConsole: true,
    targets: ["folder"],
    icon: "terminal",
    builtin: true,
  },
  {
    id: "builtin-notepadpp",
    label: "開啟至 Notepad++",
    executable: "notepad++",
    args: ["$fullFilePath"],
    workingDirectory: "",
    newConsole: false,
    targets: ["file"],
    icon: "text",
    builtin: true,
  },
  {
    id: "builtin-vscode",
    label: "開啟至 VS Code",
    executable: "code",
    args: ["$fullFilePath"],
    workingDirectory: "",
    newConsole: false,
    targets: ["file", "folder"],
    icon: "code",
    builtin: true,
  },
  /*
   * 7-Zip 的兩項動作：執行檔留空，開機偵測到就自動填入（`applyDetected7zip`）。
   * 沒填執行檔時不會出現在右鍵選單上（見 `utils/tools.ts` 的 toolMatches）。
   */
  {
    id: "builtin-7zip-add",
    label: "加入到「$fileStem.zip」",
    executable: "",
    args: ["a", "-tzip", "$fileStem.zip", "$fileName"],
    // 工作目錄＝上層資料夾：zip 要建在項目旁邊。用資料夾自己當工作目錄會把 zip
    // 建到資料夾裡面（7-Zip 會把它加進自己）。
    workingDirectory: "$parentFolderPath",
    newConsole: false,
    targets: ["file", "folder"],
    icon: "archive",
    builtin: true,
    autoDetect: "7zip",
    single: true,
  },
  {
    id: "builtin-7zip-extract",
    label: "解壓縮至「$fileStem」",
    executable: "",
    args: ["x", "$fileName", "-o$fileStem"],
    workingDirectory: "$fullFolderPath",
    newConsole: false,
    targets: ["file"],
    extensions: [
      ".zip",
      ".zipx",
      ".7z",
      ".rar",
      ".tar",
      ".gz",
      ".tgz",
      ".bz2",
      ".tbz",
      ".xz",
      ".txz",
      ".cab",
      ".iso",
      ".wim",
      ".arj",
      ".lzh",
      ".z",
      ".lzma",
    ],
    icon: "archive",
    builtin: true,
    autoDetect: "7zip",
    single: true,
  },
];

export const TOOL_ICONS = [
  "terminal",
  "code",
  "text",
  "program",
  "archive",
  "link",
  "externalLink",
] as const;

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

/** 「雙擊自動調整欄寬」的上限：超長路徑不該把欄位撐到看不完；拖曳不受此限。 */
export const COLUMN_FIT_MAX = 600;

/** 最小寬度要放得下樹工具列的七顆按鈕（加入／移除／別名／排序／定位／收合全部／收合側欄）。 */
export const TREE_MIN_WIDTH = 224;
export const TREE_MAX_WIDTH = 460;

interface StoredSettings {
  themeMode: ThemeMode;
  /** 自訂字型家族；留空＝使用系統預設字型。 */
  fontFamily: string;
  /** 介面基準字級（px）。 */
  fontSize: number;
  /** 左側清單的別名顯示格式；留空＝使用預設格式。 */
  aliasTemplate: string;
  showHidden: boolean;
  columns: ColumnId[];
  columnWidths: Record<string, number>;
  defaultSortKey: SortKey;
  defaultSortDirection: SortDirection;
  motion: MotionPreference;
  restoreSession: boolean;
  /** 監控目前資料夾，外部變更自動反映到清單。 */
  autoRefresh: boolean;
  tools: ExternalTool[];
  treeWidth: number;
  treeCollapsed: boolean;
  /** 上次分割時，第二個窗格開在哪個資料夾、用哪個方向。 */
  lastSplit: { path: string; direction: SplitDirection };
  /** Markdown 檢視器的目錄索引開關（預設開啟）。 */
  markdownTocEnabled: boolean;
  /** Markdown 檢視器的 Mermaid 圖表自動渲染（預設開啟）。 */
  mermaidEnabled: boolean;
  /** 檢視器搜尋是否把搜尋字串帶到新文件（預設不帶；面板上的「保留搜尋字串」）。 */
  viewerSearchKeepQuery: boolean;
  /** 檢視器浮動面板共用的最小寬度（px）。 */
  viewerPanelMinWidth: number;
  /** 檢視器浮動面板共用的底色不透明度（%）。 */
  viewerPanelOpacity: number;
  /** 同步瀏覽：進入子資料夾／上一層時，另一個窗格跟著做相對移動。 */
  syncBrowsing: boolean;
  /** 目錄比對：用顏色標出兩個窗格之間的差異。 */
  compareDirectories: boolean;
  /** 舊版鍵名，僅用於讀取時搬移（改名後第一次存檔就不再寫入）。 */
  markdownTocMinWidth?: number;
  markdownTocOpacity?: number;
  /** 舊版欄位，僅用於讀取時搬移。 */
  lastSplitPath?: string;
}

/** 舊版把編輯器路徑存在各自的欄位；首次升級時把它們帶進對應工具的執行檔。 */
interface LegacySettings {
  notepadppPath?: string;
  vscodePath?: string;
}

const DEFAULTS: StoredSettings = {
  themeMode: "system",
  fontFamily: "",
  fontSize: FONT_SIZE_DEFAULT,
  aliasTemplate: DEFAULT_ALIAS_TEMPLATE,
  showHidden: false,
  columns: ["name", "kind", "size", "modified"],
  columnWidths: { ...COLUMN_DEFAULTS },
  defaultSortKey: "name",
  defaultSortDirection: "asc",
  motion: "system",
  restoreSession: true,
  autoRefresh: true,
  tools: DEFAULT_TOOLS,
  treeWidth: 260,
  treeCollapsed: false,
  lastSplit: { path: "", direction: "row" },
  markdownTocEnabled: true,
  mermaidEnabled: true,
  viewerSearchKeepQuery: false,
  viewerPanelMinWidth: PANEL_MIN_WIDTH_DEFAULT,
  viewerPanelOpacity: PANEL_OPACITY_DEFAULT,
  syncBrowsing: false,
  compareDirectories: false,
};

const COLUMN_IDS = new Set<string>(ALL_COLUMNS.map((column) => column.id));

function cloneTools(tools: ExternalTool[]): ExternalTool[] {
  return tools.map((tool) => ({
    ...tool,
    args: [...tool.args],
    targets: [...tool.targets],
    extensions: [...(tool.extensions ?? [])],
  }));
}

function seedTools(raw: Partial<StoredSettings> & LegacySettings): ExternalTool[] {
  const tools = cloneTools(DEFAULT_TOOLS);
  const applyLegacy = (id: string, path?: string) => {
    if (!path) {
      return;
    }
    const tool = tools.find((item) => item.id === id);
    if (tool) {
      tool.executable = path;
    }
  };
  applyLegacy("builtin-notepadpp", raw.notepadppPath);
  applyLegacy("builtin-vscode", raw.vscodePath);
  return tools;
}

/**
 * 補上設定裡缺少的內建工具。
 *
 * 內建清單會隨版本增加（例如 7-Zip），但使用者的 `tools` 一旦存過就不會再讀
 * `DEFAULT_TOOLS`；所以每次載入都檢查一輪，**只補 id 缺少的**，既有內容（含使用者
 * 改過的路徑、引數）一律不動。
 */
function withBuiltins(tools: ExternalTool[]): ExternalTool[] {
  const known = new Set(tools.map((tool) => tool.id));
  const missing = DEFAULT_TOOLS.filter((tool) => !known.has(tool.id));
  return missing.length ? [...tools, ...cloneTools(missing)] : tools;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitize(raw: Partial<StoredSettings> & LegacySettings): StoredSettings {
  const columns = Array.isArray(raw.columns)
    ? raw.columns.filter((id): id is ColumnId => COLUMN_IDS.has(id))
    : [];
  const tools = Array.isArray(raw.tools) && raw.tools.length ? cloneTools(raw.tools) : seedTools(raw);
  const fontFamily = typeof raw.fontFamily === "string" ? raw.fontFamily : "";
  const fontSize = typeof raw.fontSize === "number" ? clampFontSize(raw.fontSize) : FONT_SIZE_DEFAULT;
  const aliasTemplate =
    typeof raw.aliasTemplate === "string" ? raw.aliasTemplate : DEFAULT_ALIAS_TEMPLATE;

  return {
    ...DEFAULTS,
    ...raw,
    columns: columns.length ? columns : DEFAULTS.columns,
    tools: withBuiltins(tools),
    fontFamily,
    fontSize,
    aliasTemplate,
    markdownTocEnabled:
      typeof raw.markdownTocEnabled === "boolean"
        ? raw.markdownTocEnabled
        : DEFAULTS.markdownTocEnabled,
    mermaidEnabled:
      typeof raw.mermaidEnabled === "boolean" ? raw.mermaidEnabled : DEFAULTS.mermaidEnabled,
    viewerSearchKeepQuery:
      typeof raw.viewerSearchKeepQuery === "boolean"
        ? raw.viewerSearchKeepQuery
        : DEFAULTS.viewerSearchKeepQuery,
    syncBrowsing:
      typeof raw.syncBrowsing === "boolean" ? raw.syncBrowsing : DEFAULTS.syncBrowsing,
    compareDirectories:
      typeof raw.compareDirectories === "boolean"
        ? raw.compareDirectories
        : DEFAULTS.compareDirectories,
    // 面板共用值 2026-10-06 從 markdownToc* 改名，舊鍵要先搬過來才不會白掉設定。
    viewerPanelMinWidth: clampPanelMinWidth(
      numberOr(raw.viewerPanelMinWidth ?? raw.markdownTocMinWidth, PANEL_MIN_WIDTH_DEFAULT),
    ),
    viewerPanelOpacity: clampPanelOpacity(
      numberOr(raw.viewerPanelOpacity ?? raw.markdownTocOpacity, PANEL_OPACITY_DEFAULT),
    ),
  };
}

/** 使用者偏好設定的唯一真實來源，任何變更都會立刻反映到 DOM 與持久化。 */
export const useSettingsStore = defineStore("settings", () => {
  const stored = sanitize(
    readJson<Partial<StoredSettings> & LegacySettings>(
      STORAGE_KEYS.settings,
      {},
      (value) => typeof value === "object",
    ),
  );

  const themeMode = ref<ThemeMode>(stored.themeMode);
  const fontFamily = ref(stored.fontFamily);
  const fontSize = ref(stored.fontSize);
  const aliasTemplate = ref(stored.aliasTemplate);
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
  const autoRefresh = ref(stored.autoRefresh);
  const tools = ref<ExternalTool[]>(stored.tools);
  const treeWidth = ref(stored.treeWidth);
  const treeCollapsed = ref(stored.treeCollapsed);
  const lastSplit = ref<{ path: string; direction: SplitDirection }>(
    stored.lastSplit ?? { path: stored.lastSplitPath ?? "", direction: "row" },
  );
  const markdownTocEnabled = ref(stored.markdownTocEnabled);
  const mermaidEnabled = ref(stored.mermaidEnabled);
  const viewerSearchKeepQuery = ref(stored.viewerSearchKeepQuery);
  const viewerPanelMinWidth = ref(stored.viewerPanelMinWidth);
  const viewerPanelOpacity = ref(stored.viewerPanelOpacity);
  const syncBrowsing = ref(stored.syncBrowsing);
  const compareDirectories = ref(stored.compareDirectories);

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

  /** 字級縮放倍率；設計權杖與清單列高都靠它換算。 */
  const fontScale = computed(() => fontSize.value / FONT_SIZE_DEFAULT);

  watchEffect(() => {
    document.documentElement.classList.toggle("dark", isDark.value);
    document.documentElement.classList.toggle("reduce-motion", reduceMotion.value);

    const style = document.documentElement.style;
    const family = normalizeFontFamily(fontFamily.value);
    if (family) {
      style.setProperty("--font-ui", family);
    } else {
      style.removeProperty("--font-ui");
    }
    style.setProperty("--font-scale", String(fontScale.value));
  });

  let persistTimer: ReturnType<typeof setTimeout> | undefined;

  // 拖曳欄寬時會高頻變動，寫入延後一點，避免每個 pointermove 都碰 localStorage。
  watch(
    [themeMode, fontFamily, fontSize, aliasTemplate, showHidden, columns, columnWidths, defaultSortKey, defaultSortDirection, motion, restoreSession, autoRefresh, tools, treeWidth, treeCollapsed, lastSplit, markdownTocEnabled, mermaidEnabled, viewerSearchKeepQuery, viewerPanelMinWidth, viewerPanelOpacity, syncBrowsing, compareDirectories],
    () => {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        writeJson(STORAGE_KEYS.settings, {
          themeMode: themeMode.value,
          fontFamily: fontFamily.value,
          fontSize: fontSize.value,
          aliasTemplate: aliasTemplate.value,
          showHidden: showHidden.value,
          columns: columns.value,
          columnWidths: columnWidths.value,
          defaultSortKey: defaultSortKey.value,
          defaultSortDirection: defaultSortDirection.value,
          motion: motion.value,
          restoreSession: restoreSession.value,
          autoRefresh: autoRefresh.value,
          tools: tools.value,
          treeWidth: treeWidth.value,
          treeCollapsed: treeCollapsed.value,
          lastSplit: lastSplit.value,
          markdownTocEnabled: markdownTocEnabled.value,
          mermaidEnabled: mermaidEnabled.value,
          viewerSearchKeepQuery: viewerSearchKeepQuery.value,
          viewerPanelMinWidth: viewerPanelMinWidth.value,
          viewerPanelOpacity: viewerPanelOpacity.value,
          syncBrowsing: syncBrowsing.value,
          compareDirectories: compareDirectories.value,
        } satisfies StoredSettings);
      }, 200);
    },
    { deep: true },
  );

  function toggleTheme() {
    themeMode.value = isDark.value ? "light" : "dark";
  }

  function setFontSize(value: number) {
    fontSize.value = clampFontSize(value);
  }

  /** 回到系統預設字型與基準字級。 */
  function resetFont() {
    fontFamily.value = "";
    fontSize.value = FONT_SIZE_DEFAULT;
  }

  function resetAliasTemplate() {
    aliasTemplate.value = DEFAULT_ALIAS_TEMPLATE;
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

  /** 預設欄寬：新開的窗格會從這裡出發，之後各自獨立。 */
  function resetColumnWidths() {
    columnWidths.value = { ...COLUMN_DEFAULTS };
  }

  /**
   * 資料夾樹是整個分頁共用的一份，寬度與收合狀態因此也是全域的。
   * `clamp = false` 供拖曳中使用：允許短暫越界，讓呼叫端做橡皮筋與回彈。
   */
  function setTreeWidth(width: number, clamp = true) {
    const rounded = Math.round(width);
    treeWidth.value = clamp
      ? Math.min(Math.max(rounded, TREE_MIN_WIDTH), TREE_MAX_WIDTH)
      : rounded;
  }

  function toggleTree() {
    treeCollapsed.value = !treeCollapsed.value;
  }

  /** Markdown 檢視器的目錄索引開關；沒有標題時呼叫端會自行停用。 */
  function toggleMarkdownToc() {
    markdownTocEnabled.value = !markdownTocEnabled.value;
  }

  /** 同步瀏覽：開啟後另一個窗格跟著做相對移動（見 §同步瀏覽）。 */
  function toggleSyncBrowsing() {
    syncBrowsing.value = !syncBrowsing.value;
  }

  /** 目錄比對：開啟後清單用顏色標出兩邊的差異。 */
  function toggleCompareDirectories() {
    compareDirectories.value = !compareDirectories.value;
  }

  function setViewerSearchKeepQuery(value: boolean) {
    viewerSearchKeepQuery.value = value;
  }

  function setViewerPanelMinWidth(value: number) {
    viewerPanelMinWidth.value = clampPanelMinWidth(value);
  }

  function setViewerPanelOpacity(value: number) {
    viewerPanelOpacity.value = clampPanelOpacity(value);
  }

  /** 記住分割出來的那個窗格上次開在哪、用哪個方向。 */
  function rememberSplit(path: string, direction: SplitDirection) {
    if (lastSplit.value.path === path && lastSplit.value.direction === direction) {
      return;
    }
    lastSplit.value = { path, direction };
  }

  /** 建立工具；`initial` 讓編輯器一次寫入整份草稿（id 一律由這裡產生）。 */
  function addTool(initial: Partial<ExternalTool> = {}): ExternalTool {
    const tool: ExternalTool = {
      label: "新工具",
      executable: "",
      args: ["$fullFilePath"],
      // 新工具預設就在「選取項目所在的資料夾」執行；要沿用行程目前位置就清空。
      workingDirectory: "$fullFolderPath",
      newConsole: false,
      targets: ["file"],
      // 留空＝所有檔案都會出現；填了才依副檔名篩選。
      extensions: [],
      icon: "program",
      ...initial,
      id: `tool-${Date.now().toString(36)}`,
    };
    tools.value = [...tools.value, tool];
    return tool;
  }

  function updateTool(id: string, patch: Partial<ExternalTool>) {
    tools.value = tools.value.map((tool) => (tool.id === id ? { ...tool, ...patch } : tool));
  }

  function removeTool(id: string) {
    tools.value = tools.value.filter((tool) => tool.id !== id || tool.builtin);
  }

  /** 內建工具被改壞時的逃生門；自訂工具不受影響。 */
  function resetTools() {
    const custom = tools.value.filter((tool) => !tool.builtin);
    tools.value = [...cloneTools(DEFAULT_TOOLS), ...custom];
  }

  /**
   * 開機偵測到的 7-Zip 路徑。
   *
   * 只填**空白**的執行檔（見 `types/tools.ts` 的 `autoDetect`）：使用者自己指到
   * 可攜版或其他版本時不會被蓋掉；要停用就把編輯頁的「啟用」關掉。
   */
  function applyDetected7zip(path: string) {
    if (!path.trim()) {
      return;
    }
    let changed = false;
    const next = tools.value.map((tool) => {
      if (tool.autoDetect !== "7zip" || tool.executable.trim()) {
        return tool;
      }
      changed = true;
      return { ...tool, executable: path };
    });
    if (changed) {
      tools.value = next;
    }
  }

  return {
    themeMode,
    fontFamily,
    fontSize,
    aliasTemplate,
    showHidden,
    columns,
    columnWidths,
    defaultSortKey,
    defaultSortDirection,
    motion,
    restoreSession,
    autoRefresh,
    tools,
    treeWidth,
    treeCollapsed,
    lastSplit,
    isDark,
    reduceMotion,
    prefersReducedMotion,
    fontScale,
    toggleTheme,
    setFontSize,
    resetFont,
    resetAliasTemplate,
    toggleColumn,
    resetColumnWidths,
    setTreeWidth,
    toggleTree,
    markdownTocEnabled,
    mermaidEnabled,
    viewerSearchKeepQuery,
    viewerPanelMinWidth,
    viewerPanelOpacity,
    syncBrowsing,
    compareDirectories,
    toggleMarkdownToc,
    toggleSyncBrowsing,
    toggleCompareDirectories,
    setViewerSearchKeepQuery,
    setViewerPanelMinWidth,
    setViewerPanelOpacity,
    rememberSplit,
    addTool,
    updateTool,
    removeTool,
    resetTools,
    applyDetected7zip,
  };
});

// 開發時熱更新會替換模組，Pinia 需要明確接手，否則既有 store 實例會失效。
// setup store 內有非響應式快取（項目陣列、AbortController、子節點快取），
// 熱更新無法安全接手，整頁重載才能保證狀態一致；工作階段會從 localStorage 還原。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
