import type { TextBookmarkAnchor } from "@/types/bookmarks";
import {
  fingerprintMatches,
  MAX_ANCHOR_TEXT,
  MAX_CONTEXT,
  nearestIndex,
  normalizeText,
  prefixMatches,
  rangeAt,
  textOffsetBefore,
  type BookmarkSpot,
} from "@/utils/bookmarkAnchor";

/**
 * 純文字／程式碼書籤的錨點計算。
 *
 * 這一種內容（`TextView` 的 `<pre>`）沒有段落，整份就是一行行的文字，所以位置記的是
 * 「整份可見文字的位移 ＋ 第幾行 ＋ 那一行的內容（指紋）」。位移會因為前面的文字被
 * 增刪而全部平移，行號也一樣 —— 所以對位時以**行指紋**為主，行號只用來挑最接近的
 * 那一個，位移則在「那個位置的文字真的還是同一段」時才拿來精準標示。
 *
 * 解析只用字串運算（文字來源是 `ViewerState.text`，不整份複製 DOM 文字），
 * 只有最後建立 `Range` 才碰 DOM。
 */

/** 一行文字（1 起算的行號與它在整份文字裡的範圍）。 */
export interface TextLine {
  number: number;
  start: number;
  end: number;
}

/** 位移所在的那一行。 */
export function lineAt(text: string, offset: number): TextLine {
  const at = Math.min(Math.max(0, offset), text.length);
  const start = text.lastIndexOf("\n", at - 1) + 1;
  const next = text.indexOf("\n", at);
  return { number: countLines(text, start) + 1, start, end: next === -1 ? text.length : next };
}

/** 第 `number` 行（1 起算）的範圍；超出範圍時回最後一行。 */
export function lineByNumber(text: string, number: number): TextLine {
  const wanted = Math.max(1, Math.round(number));
  let start = 0;
  for (let index = 1; index < wanted; index += 1) {
    const next = text.indexOf("\n", start);
    if (next === -1) {
      return { number: index, start, end: text.length };
    }
    start = next + 1;
  }
  const end = text.indexOf("\n", start);
  return { number: wanted, start, end: end === -1 ? text.length : end };
}

/** 目前選取範圍在整份文字裡的錨點；沒有選取、或選取不在這個內容裡時回 null。 */
export function textAnchorFromSelection(
  root: HTMLElement | null,
  text: string,
  selection: Selection | null,
): TextBookmarkAnchor | null {
  if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) {
    return null;
  }
  const measured = textOffsetBefore(root, range.startContainer, range.startOffset);
  if (measured < 0 || measured > text.length) {
    return null;
  }

  const selected = range.toString();
  if (!selected.trim()) {
    return null;
  }
  const line = lineAt(text, measured);
  const length = Math.min(Math.max(1, selected.length), Math.max(1, text.length - measured));

  return {
    kind: "text",
    text: selected.slice(0, MAX_ANCHOR_TEXT),
    offset: measured,
    length,
    line: line.number,
    lineText: text.slice(line.start, line.end).slice(0, MAX_CONTEXT),
  };
}

/**
 * 把錨點對回目前的文字；對不回來時回 null。
 *
 * 依序嘗試：原本那幾行的指紋 → 指紋相同且最接近原行號的行 → 開頭相同的行 →
 * 選取的文字還在某處。前三條會把「整行」當成落點（對得到精準文字就只標示那幾個字），
 * 最後一條只標示選取的文字。
 */
export function resolveTextAnchor(
  root: HTMLElement | null,
  text: string,
  anchor: TextBookmarkAnchor,
): BookmarkSpot | null {
  if (!root || !text) {
    return null;
  }

  const wanted = normalizeText(anchor.lineText);
  const line = wanted ? findLine(text, anchor.line, wanted) : null;
  if (line) {
    const raw = text.slice(line.start, line.end);
    const at = anchor.text ? raw.indexOf(anchor.text) : -1;
    if (at >= 0) {
      const range = rangeAt(root, line.start + at, anchor.text.length);
      return range ? { target: range, range } : lineSpot(root, line);
    }
    return lineSpot(root, line);
  }

  // 行指紋完全對不上：退到「選取的文字還在不在」，取最靠近原位移的那一處。
  const found = nearestOccurrence(text, anchor.text, anchor.offset);
  if (found < 0) {
    return null;
  }
  const range = rangeAt(root, found, anchor.text.length);
  return range ? { target: range, range } : null;
}

/** 找到「最靠近原行號、指紋相符」的那一行。 */
function findLine(text: string, number: number, wanted: string): TextLine | null {
  const hinted = lineByNumber(text, number);
  if (fingerprintMatches(normalizeText(text.slice(hinted.start, hinted.end)), wanted)) {
    return hinted;
  }

  // 行號會因為前面增刪行而位移，所以整份掃一遍找指紋相符、最靠近原行號的行。
  const lines = allLines(text);
  const texts = lines.map((line) => normalizeText(text.slice(line.start, line.end)));
  const exact = nearestIndex(lines.length, number - 1, (index) =>
    fingerprintMatches(texts[index], wanted),
  );
  if (exact >= 0) {
    return lines[exact];
  }
  // 那一行被改寫過：開頭還一樣就當成同一行。
  const prefix = nearestIndex(lines.length, number - 1, (index) =>
    prefixMatches(texts[index], wanted),
  );
  return prefix >= 0 ? lines[prefix] : null;
}

/** 整行的落點（對不到精準文字時）。 */
function lineSpot(root: HTMLElement, line: TextLine): BookmarkSpot {
  const range = rangeAt(root, line.start, line.end - line.start);
  if (!range) {
    return { target: root, range: null };
  }
  return { target: range, range };
}

/** 所有行的範圍（行號 1 起算）。 */
function allLines(text: string): TextLine[] {
  const lines: TextLine[] = [];
  let start = 0;
  for (let number = 1; ; number += 1) {
    const next = text.indexOf("\n", start);
    if (next === -1) {
      lines.push({ number, start, end: text.length });
      return lines;
    }
    lines.push({ number, start, end: next });
    start = next + 1;
  }
}

/** 1 起算：位移之前有幾個換行。 */
function countLines(text: string, until: number): number {
  let count = 0;
  for (let at = text.indexOf("\n"); at !== -1 && at < until; at = text.indexOf("\n", at + 1)) {
    count += 1;
  }
  return count;
}

/** `needle` 在 `text` 裡最靠近 `target` 的那一處；找不到回 -1。 */
function nearestOccurrence(text: string, needle: string, target: number): number {
  if (!needle) {
    return -1;
  }
  let best = -1;
  let distance = Number.POSITIVE_INFINITY;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const current = Math.abs(at - target);
    if (current < distance) {
      best = at;
      distance = current;
    }
  }
  return best;
}
