import type { FileEntry } from "@/types/fs";

/**
 * 檔案清單的「種類快速篩選」（路徑列搜尋框右邊的漏斗鈕）與設定頁的資料模型。
 *
 * 這裡只有資料與純函數：每個群組是一組副檔名，`其它` 代表「不在目前啟用的
 * 具名群組裡的檔案」（含沒有副檔名）。群組清單由使用者在設定頁調整，
 * 實際的選取狀態存在每個窗格（`PaneMeta.typeFilters`）。
 */

export interface FileTypeGroup {
  /** 內建固定（`docx`、`pdf`…、`other`）；自訂是 `custom-<timestamp>`。 */
  id: string;
  /** pill 上的文字（`.docx`，或自訂的名稱）。 */
  label: string;
  /** tooltip。 */
  hint: string;
  /** 不含點、小寫的副檔名；`other` 是空的。 */
  extensions: string[];
  /** 是否出現在漏斗鈕。 */
  enabled: boolean;
  /** 內建群組不可刪除（可以停用）；自訂可以刪除。 */
  builtin: boolean;
}

/** `其它` 的固定 id：比對基準是「目前啟用的具名群組」。 */
export const OTHER_GROUP_ID = "other";
/** 漏斗鈕最多幾個群組（再多 popover 就變成一整面牆）。 */
export const MAX_QUICK_FILTER_GROUPS = 30;
/** 自訂群組最多幾個副檔名。 */
export const MAX_EXTENSIONS_PER_GROUP = 12;
/** 單一副檔名的最長長度。 */
const MAX_EXTENSION_LENGTH = 16;
/** 自訂群組名稱的最長長度。 */
const MAX_LABEL_LENGTH = 40;

/**
 * 內建群組（預設全部啟用）。
 *
 * 順序就是漏斗鈕裡的預設順序；`.pdf` 放在文件類後面。`其它` 永遠最後。
 * 新增內建群組時，`withDefaultGroups()` 會幫既有使用者補上（只補缺少的），
 * 所以舊設定不會漏掉新種類。
 */
const BUILTIN_GROUPS: readonly FileTypeGroup[] = [
  { id: "docx", label: ".docx", hint: "Word 文件", extensions: ["docx"], enabled: true, builtin: true },
  { id: "xlsx", label: ".xlsx", hint: "Excel 試算表", extensions: ["xlsx"], enabled: true, builtin: true },
  { id: "pptx", label: ".pptx", hint: "PowerPoint 簡報", extensions: ["pptx"], enabled: true, builtin: true },
  { id: "pdf", label: ".pdf", hint: "PDF 文件", extensions: ["pdf"], enabled: true, builtin: true },
  {
    id: "md",
    label: ".md",
    hint: "Markdown（含 .markdown）",
    extensions: ["md", "markdown"],
    enabled: true,
    builtin: true,
  },
  { id: "txt", label: ".txt", hint: "純文字", extensions: ["txt"], enabled: true, builtin: true },
  { id: "json", label: ".json", hint: "JSON", extensions: ["json"], enabled: true, builtin: true },
  { id: "yml", label: ".yml", hint: "YAML（含 .yaml）", extensions: ["yml", "yaml"], enabled: true, builtin: true },
  { id: "exe", label: ".exe", hint: "執行檔", extensions: ["exe"], enabled: true, builtin: true },
  {
    id: "image",
    label: ".png/.jpg",
    hint: "圖片（含 .jpeg／.jfif）",
    extensions: ["png", "jpg", "jpeg", "jfif"],
    enabled: true,
    builtin: true,
  },
  {
    id: "archive",
    label: ".7z/.zip/.rar",
    hint: "壓縮檔",
    extensions: ["7z", "zip", "rar"],
    enabled: true,
    builtin: true,
  },
  {
    id: OTHER_GROUP_ID,
    label: "其它",
    hint: "不在目前啟用的分類裡的檔案（含沒有副檔名）",
    extensions: [],
    enabled: true,
    builtin: true,
  },
];

const BUILTIN_BY_ID = new Map(BUILTIN_GROUPS.map((group) => [group.id, group]));

/** 預設群組的深拷貝（給 DEFAULTS 與「重設」用）。 */
export function defaultFileTypeGroups(): FileTypeGroup[] {
  return BUILTIN_GROUPS.map((group) => ({ ...group, extensions: [...group.extensions] }));
}

/**
 * 把使用者輸入的副檔名整理成乾淨的清單。
 *
 * 接受逗號、空白、分號、頓號分隔；去掉開頭的點、轉小寫、去重。
 * 只留最後一段（`FileEntry.extension` 只給最後一段，所以 `tar.gz` 永遠比不到）。
 */
export function parseExtensions(value: string | readonly string[]): string[] {
  const parts = Array.isArray(value) ? value : String(value).split(/[\s,;、]+/);
  const result: string[] = [];
  for (const part of parts) {
    const extension = String(part)
      .trim()
      .replace(/^\.+/, "")
      .toLocaleLowerCase();
    if (!extension || result.includes(extension)) {
      continue;
    }
    if (!/^[a-z0-9]+$/.test(extension) || extension.length > MAX_EXTENSION_LENGTH) {
      continue;
    }
    result.push(extension);
    if (result.length >= MAX_EXTENSIONS_PER_GROUP) {
      break;
    }
  }
  return result;
}

/** 建立一個自訂群組；副檔名解析不出來時回 `null`。 */
export function createCustomGroup(
  id: string,
  label: string,
  extensions: string | readonly string[],
): FileTypeGroup | null {
  const parsed = parseExtensions(extensions);
  if (!parsed.length) {
    return null;
  }
  return {
    id,
    label: label.trim().slice(0, MAX_LABEL_LENGTH) || `.${parsed[0]}`,
    hint: `副檔名：${parsed.map((extension) => `.${extension}`).join(" ")}`,
    extensions: parsed,
    enabled: true,
    builtin: false,
  };
}

/**
 * 讀取既有設定時的清洗：內建群組的標籤／副檔名一律以內建定義為準（只保留啟用狀態），
 * 自訂群組保留名稱與副檔名；壞資料直接丟掉。
 */
export function normalizeStoredGroups(value: unknown): FileTypeGroup[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: FileTypeGroup[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const raw = item as Partial<FileTypeGroup>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id || seen.has(id)) {
      continue;
    }

    const builtin = BUILTIN_BY_ID.get(id);
    if (builtin) {
      result.push({ ...builtin, extensions: [...builtin.extensions], enabled: raw.enabled !== false });
      seen.add(id);
      continue;
    }

    if (!id.startsWith("custom-")) {
      continue;
    }
    const extensions = parseExtensions(Array.isArray(raw.extensions) ? raw.extensions : []);
    if (!extensions.length) {
      continue;
    }
    result.push({
      id,
      label:
        (typeof raw.label === "string" ? raw.label.trim().slice(0, MAX_LABEL_LENGTH) : "") ||
        `.${extensions[0]}`,
      hint: `副檔名：${extensions.map((extension) => `.${extension}`).join(" ")}`,
      extensions,
      enabled: raw.enabled !== false,
      builtin: false,
    });
    seen.add(id);
  }

  return result;
}

/**
 * 補上缺少的內建群組（例如後來才加的 `.pdf`）。
 *
 * 只補缺少的：使用者的順序、停用狀態與自訂群組都不動。補進來的放在 `其它` 之前，
 * 維持「其它永遠最後」的慣例。
 */
export function withDefaultGroups(groups: readonly FileTypeGroup[]): FileTypeGroup[] {
  const next = groups.map((group) => ({ ...group, extensions: [...group.extensions] }));
  const known = new Set(next.map((group) => group.id));
  const missing = BUILTIN_GROUPS.filter((group) => !known.has(group.id));
  if (missing.length) {
    const additions = missing.map((group) => ({ ...group, extensions: [...group.extensions] }));
    const otherIndex = next.findIndex((group) => group.id === OTHER_GROUP_ID);
    if (otherIndex >= 0) {
      next.splice(otherIndex, 0, ...additions);
    } else {
      next.push(...additions);
    }
  }
  return next.slice(0, MAX_QUICK_FILTER_GROUPS);
}

/** 漏斗鈕會畫出來的群組（依設定順序）。 */
export function activeTypeGroups(groups: readonly FileTypeGroup[]): FileTypeGroup[] {
  return groups.filter((group) => group.enabled);
}

/** 目前選取的種類要怎麼唸（依群組順序，例如 `.docx、其它`）。 */
export function fileTypeSummary(ids: readonly string[], groups: readonly FileTypeGroup[]): string {
  return groups
    .filter((group) => ids.includes(group.id))
    .map((group) => group.label)
    .join("、");
}

/**
 * 建一個「這一項符不符合目前選取」的判斷函式。
 *
 * 先把副檔名集合建好，`recompute()` 對上萬筆項目逐項比對時不必重掃群組。
 * 選了「其它」時，停用群組的副檔名也會算進「其它」（判定基準是**啟用**的具名群組）。
 * 沒有任何有效選取時回「全部符合」—— 呼叫端就不用自己判斷。
 */
export function createTypeMatcher(
  groups: readonly FileTypeGroup[],
  selectedIds: readonly string[],
): (entry: Pick<FileEntry, "isDir" | "extension">) => boolean {
  const selected = new Set(selectedIds);
  const named = new Set<string>();
  const chosen = new Set<string>();

  for (const group of groups) {
    if (!group.enabled || group.id === OTHER_GROUP_ID) {
      continue;
    }
    for (const extension of group.extensions) {
      named.add(extension);
      if (selected.has(group.id)) {
        chosen.add(extension);
      }
    }
  }

  const useOther = selected.has(OTHER_GROUP_ID) && groups.some((group) => group.id === OTHER_GROUP_ID && group.enabled);
  if (!chosen.size && !useOther) {
    return () => true;
  }

  return (entry) => {
    if (entry.isDir) {
      return false;
    }
    const extension = entry.extension?.toLocaleLowerCase() ?? "";
    if (chosen.has(extension)) {
      return true;
    }
    return useOther && !named.has(extension);
  };
}
