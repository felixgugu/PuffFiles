/**
 * 檢視器搜尋的純函數：比對、行號與顯示片段。
 *
 * 這裡不碰 DOM、也不依賴 Vue：把「一段文字 + 三個選項」變成命中清單，
 * 標記與捲動交給 `composables/useViewerSearch.ts`。位移一律是 UTF-16
 * code unit，跟 DOM 文字節點的位移同一套座標，所以可以直接對應。
 */

export interface SearchOptions {
  /** 大小寫須相符。 */
  caseSensitive: boolean;
  /** 只比對完整字詞。 */
  wholeWord: boolean;
  /** 把搜尋字串當成 Regex。 */
  regex: boolean;
}

/** 命中在顯示文字裡的位置（用來把命中那段上色）。 */
export interface HitSnippet {
  text: string;
  matchStart: number;
  matchEnd: number;
}

export interface SearchHit {
  /** 在搜尋文字裡的起訖位移。 */
  start: number;
  end: number;
  /** 1 起算的行號。 */
  lineNumber: number;
  /** 命中所在的那一行／區塊（過長時保留命中附近的一段）。 */
  lineText: HitSnippet;
}

export interface SearchResult {
  hits: SearchHit[];
  /** 命中超過上限，只回了前 `MAX_SEARCH_HITS` 筆。 */
  truncated: boolean;
  /** 內容超過可搜尋大小，這一輪沒有搜尋。 */
  tooLarge: boolean;
  /** Regex 不合法時的訊息。 */
  error: string | null;
}

/** 命中筆數上限：超過只列前面這些，避免一次長出上萬個 DOM 節點。 */
export const MAX_SEARCH_HITS = 2000;
/** 可搜尋的文字大小上限；超過就停用搜尋（沿用 hljs 1 MB 停用的同一套哲學）。 */
export const MAX_SEARCH_TEXT = 4 * 1024 * 1024;
/** 搜尋字串長度上限：Regex 的編譯成本由它把關。 */
export const MAX_SEARCH_QUERY = 200;
/** 命中列最多顯示幾個字（超過以命中為中心裁切）。 */
const LINE_MAX = 240;
/** 裁切長行時，命中前面留幾個字當前後文（保證命中看得到）。 */
const LINE_LEAD = 12;

const EMPTY: SearchResult = { hits: [], truncated: false, tooLarge: false, error: null };

/** 把字面值變成安全的 Regex 來源。 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ASCII 字詞邊界；CJK 沒有詞邊界，行為與 VS Code 的「全字」一致。 */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[0-9A-Za-z_]/.test(char);
}

function isWholeWord(text: string, start: number, end: number): boolean {
  return !isWordChar(text[start - 1]) && !isWordChar(text[end]);
}

/**
 * 取命中所在的整行（以 `\n` 切）。
 *
 * 渲染後的內容每一塊都會被 `useViewerSearch` 補上換行，所以這裡的「行」
 * 就是那一個段落／標題／清單項；純文字與程式碼則是真的原始行。
 */
function lineSnippet(text: string, start: number, end: number): { lineNumber: number; line: HitSnippet } {
  let lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = text.indexOf("\n", end);
  let lineEnd = nextBreak === -1 ? text.length : nextBreak;
  let lineNumber = 1;
  for (let index = text.indexOf("\n"); index !== -1 && index < start; index = text.indexOf("\n", index + 1)) {
    lineNumber += 1;
  }

  // 去掉行首尾空白，位移要跟著平移。
  const raw = text.slice(lineStart, lineEnd).replace(/\r$/, "");
  const leading = raw.length - raw.trimStart().length;
  lineStart += leading;
  lineEnd = lineStart + raw.trimEnd().length - leading;

  let matchStart = start - lineStart;
  let matchEnd = end - lineStart;
  let value = text.slice(lineStart, lineEnd);
  if (value.length > LINE_MAX) {
    const from = Math.max(0, Math.min(matchStart - LINE_LEAD, value.length - LINE_MAX));
    value = value.slice(from, from + LINE_MAX);
    matchStart -= from;
    matchEnd -= from;
  }
  return { lineNumber, line: { text: value, matchStart, matchEnd } };
}

/**
 * 在 `text` 裡找出所有命中。
 *
 * 空字元的命中（例如 `^`、`a*`）會被略過 —— 它們沒有可標記的範圍，還會讓
 * 迭代卡在原地。命中數與內容大小都有上限，超過就回報旗標由面板顯示。
 */
export function searchText(text: string, query: string, options: SearchOptions): SearchResult {
  if (!query) {
    return EMPTY;
  }
  if (text.length > MAX_SEARCH_TEXT) {
    return { ...EMPTY, tooLarge: true };
  }

  const pattern = options.regex
    ? query.slice(0, MAX_SEARCH_QUERY)
    : escapeRegExp(query.slice(0, MAX_SEARCH_QUERY));
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, options.caseSensitive ? "g" : "gi");
  } catch {
    return { ...EMPTY, error: "Regex 語法錯誤" };
  }

  const hits: SearchHit[] = [];
  let truncated = false;
  let match = regex.exec(text);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    if (end === start) {
      regex.lastIndex += 1;
      match = regex.exec(text);
      continue;
    }
    if (!options.wholeWord || isWholeWord(text, start, end)) {
      const line = lineSnippet(text, start, end);
      hits.push({
        start,
        end,
        lineNumber: line.lineNumber,
        lineText: line.line,
      });
      if (hits.length >= MAX_SEARCH_HITS) {
        truncated = true;
        break;
      }
    }
    match = regex.exec(text);
  }

  return { hits, truncated, tooLarge: false, error: null };
}
