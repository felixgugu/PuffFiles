import type { BookmarkAnchor } from "@/types/bookmarks";

/**
 * 書籤錨點的共用部分（與 Vue、store 無關的純邏輯）。
 *
 * 檢視器的內容每次渲染都是全新的 DOM，所以書籤記的是「文字 ＋ 它附近的線索」，
 * 對位時再從線索把位置找回來。兩種內容（DOCX 的區塊、純文字的行）記的線索不同，
 * 但「正規化、指紋比對、位移 ↔ Range、名稱、排序與去重」是同一套，放這裡。
 */

/** 存進資料庫的選取文字上限。 */
export const MAX_ANCHOR_TEXT = 200;
/** 存進資料庫的上下文（區塊文字／行文字）上限；這是位置的指紋。 */
export const MAX_CONTEXT = 240;
/** 書籤名稱的長度上限（面板一列一行，再長也看不完）。 */
export const MAX_LABEL = 80;
/** 指紋短於這個長度時只接受整段相符，免得「第 1 條」對到「第 10 條」。 */
export const MIN_FINGERPRINT = 24;
/** 段落／行被改寫過時，開頭這麼多字一樣就當成同一段。 */
export const SHORT_FINGERPRINT = 20;
/** 指定的文字太長時仍然把整段當指紋比對的門檻。 */
export const LOOSE_FINGERPRINT = 40;

/** 對回位置之後的目標。 */
export interface BookmarkSpot {
  /** 捲動定位的目標；元素與 `Range` 都有 `getBoundingClientRect()`。 */
  target: Element | Range;
  /** 要選取標示的文字範圍；`null`＝只跳到目標，不標示。 */
  range: Range | null;
  /** 需要淡藍底閃示的元素（DOCX 的區塊）；純文字沒有。 */
  flash?: Element | null;
}

/** 比對用的正規化：換行、連續空白都收成單一空格（位移仍然算原始文字）。 */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** 書籤的預設名稱：選取的文字收成一行，太長就截斷。 */
export function bookmarkLabel(text: string): string {
  const line = normalizeText(text);
  if (!line) {
    return "書籤";
  }
  return line.length > MAX_LABEL ? `${line.slice(0, MAX_LABEL - 1)}…` : line;
}

/** 兩份文字是不是同一個「位置指紋」（整段相符、開頭相符，或整段還在裡面）。 */
export function fingerprintMatches(text: string, wanted: string): boolean {
  if (!wanted || !text) {
    return false;
  }
  if (text === wanted) {
    return true;
  }
  if (wanted.length < MIN_FINGERPRINT) {
    return false;
  }
  if (text.startsWith(wanted)) {
    return true;
  }
  return wanted.length >= LOOSE_FINGERPRINT && text.includes(wanted);
}

/** 只比對開頭（段落／行被改寫過，但還是同一段）：只跳過去，不標示文字。 */
export function prefixMatches(text: string, wanted: string): boolean {
  if (!wanted || !text) {
    return false;
  }
  return text.startsWith(wanted.slice(0, SHORT_FINGERPRINT));
}

/**
 * 符合條件、且索引最接近 `target` 的候選索引（同距離取前面的那一個）；沒有就回 -1。
 */
export function nearestIndex(
  length: number,
  target: number,
  match: (index: number) => boolean,
): number {
  let best = -1;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < length; index += 1) {
    if (!match(index)) {
      continue;
    }
    const current = Math.abs(index - target);
    if (current < distance) {
      best = index;
      distance = current;
    }
  }
  return best;
}

/** 從容器開頭到 `(node, offset)` 為止的文字長度；節點不在容器裡時回 -1。 */
export function textOffsetBefore(root: HTMLElement, node: Node, offset: number): number {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
  } catch {
    return -1;
  }
  return range.toString().length;
}

/** 容器內第 `offset` 個字所在的文字節點；超出結尾時停在最後一個節點。 */
export function locateOffset(
  root: HTMLElement,
  offset: number,
): { node: Text; offset: number } | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    last = text;
    if (remaining <= text.data.length) {
      return { node: text, offset: remaining };
    }
    remaining -= text.data.length;
  }
  return last ? { node: last, offset: last.data.length } : null;
}

/** 容器內某一段文字（`[offset, offset + length)`）的 DOM 範圍；對不上時回 null。 */
export function rangeAt(root: HTMLElement, offset: number, length: number): Range | null {
  if (!(length > 0)) {
    return null;
  }
  const start = locateOffset(root, offset);
  const end = locateOffset(root, offset + length);
  if (!start || !end) {
    return null;
  }
  const range = root.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/** 兩個錨點是不是同一個位置（判斷「這一段已經是書籤了」）。 */
export function sameAnchor(a: BookmarkAnchor, b: BookmarkAnchor): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "docx" && b.kind === "docx") {
    return a.blockIndex === b.blockIndex && a.offset === b.offset && a.text === b.text;
  }
  return a.kind === "text" && b.kind === "text" && a.offset === b.offset && a.text === b.text;
}

/** 錨點在文件裡的位置（面板排序用）：越大＝越後面。 */
export function anchorPosition(anchor: BookmarkAnchor): number {
  return anchor.kind === "docx" ? anchor.blockIndex : anchor.offset;
}
