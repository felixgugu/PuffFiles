/**
 * 字型設定的純函數。UI 只負責收集字串，這裡把它整理成可直接餵給 CSS 的片段。
 */

/**
 * CSS 泛用字型家族關鍵字：加了引號就會變成「名字叫 monospace」的字型，
 * 反而找不到，所以要原樣保留。
 */
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

export const FONT_SIZE_MIN = 11;
export const FONT_SIZE_MAX = 18;
export const FONT_SIZE_DEFAULT = 13;

/** 把字級夾進可讀範圍並取整；非數字一律退回預設值。 */
export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return FONT_SIZE_DEFAULT;
  }
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)));
}

/**
 * 逐一為家族名稱補上引號，支援以逗號分隔的候選清單。
 * 留空＝沒有自訂字型，回傳空字串，由樣式表的系統字型堆疊接手。
 */
export function normalizeFontFamily(input: string): string {
  return input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((name) =>
      GENERIC_FAMILIES.has(name.toLowerCase()) ? name : `"${name.replace(/["\\]/g, "\\$&")}"`,
    )
    .join(", ");
}
