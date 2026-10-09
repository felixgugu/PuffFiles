import type { DocxBookmarkAnchor } from "@/types/bookmarks";
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
 * DOCX 書籤的錨點計算（與 Vue、store 無關的 DOM 邏輯）。
 *
 * `docx-preview` 的排版結果是「一頁一個 `<section class="docx">`，內文放在 `article`
 * 裡」，段落、標題、清單與公式都是 `<p>`，表格是 `<table>`。書籤因此以這兩種元素
 * 當成「區塊」：整份文件的區塊依文件順序編號，選取範圍落在哪一個區塊、在區塊裡
 * 第幾個字，就是這個書籤的位置。
 *
 * 重新排版後位置會全部重來，所以對回位置時依序嘗試：
 * 1. 原本的區塊索引 ＋ 區塊文字指紋（文件沒動過時一定命中）。
 * 2. 指紋一樣、最靠近原索引的區塊（文件前面增刪了段落）。
 * 3. 區塊開頭一樣（段落被改寫過，但還是那一段）：跳到那一段，不標示文字。
 * 4. 選取的文字還在某個區塊裡（只跳到那個區塊，不標示文字）。
 * 都對不上就當成失效（面板上淡化並說明）。
 */

/** 收錄成書籤的區塊；`<p>` 涵蓋段落、標題、清單與公式，表格另外算一個。 */
const BLOCK_SELECTOR = "p, table";

/** 跳到書籤時標示用的類別（樣式在 `DocxView.vue` 的 scoped `:deep()`）。 */
export const BOOKMARK_FLASH_CLASS = "docx-bookmark-flash";

/**
 * 目前的內容區塊（文件順序）。
 *
 * 只收 `article`（docx-preview 的內文容器）裡的區塊：頁首頁尾會逐頁重複，不是內文。
 * 找不到 `article`（版本差異）時退回整頁，至少還找得到位置。
 */
export function docxBlocks(root: HTMLElement | null): HTMLElement[] {
  if (!root) {
    return [];
  }
  const pages = root.querySelectorAll<HTMLElement>("section.docx");
  const scope: HTMLElement[] = pages.length ? [...pages] : [root];
  const blocks: HTMLElement[] = [];
  for (const page of scope) {
    const bodies = page.querySelectorAll<HTMLElement>("article");
    const hosts: HTMLElement[] = bodies.length ? [...bodies] : [page];
    for (const host of hosts) {
      blocks.push(...host.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
    }
  }
  return blocks;
}

/** 選取範圍所在的區塊索引；不在任何區塊裡時回 -1。 */
function blockIndexOf(node: Node | null, blocks: HTMLElement[]): number {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  if (!element) {
    return -1;
  }
  const closest = element.closest<HTMLElement>(BLOCK_SELECTOR);
  const direct = closest ? blocks.indexOf(closest) : -1;
  if (direct >= 0) {
    return direct;
  }
  // 選取落在表格的儲存格內容、或某個被包住的容器裡：往上找第一個收錄的區塊。
  for (let current = element.parentElement; current; current = current.parentElement) {
    const index = blocks.indexOf(current);
    if (index >= 0) {
      return index;
    }
  }
  return -1;
}

/** 目前選取範圍在文件裡的錨點；沒有選取、或選取不在內文區塊裡時回 null。 */
export function docxAnchorFromSelection(
  root: HTMLElement | null,
  selection: Selection | null,
): DocxBookmarkAnchor | null {
  const blocks = docxBlocks(root);
  if (!blocks.length || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const index = blockIndexOf(range.startContainer, blocks);
  if (index < 0) {
    return null;
  }
  const block = blocks[index];
  const blockText = block.textContent ?? "";
  if (!blockText.trim()) {
    return null;
  }

  const measured = textOffsetBefore(block, range.startContainer, range.startOffset);
  const offset = Math.min(Math.max(0, measured), blockText.length);
  const selected = range.toString();
  const length = Math.min(Math.max(1, selected.length), Math.max(1, blockText.length - offset));

  return {
    kind: "docx",
    text: selected.slice(0, MAX_ANCHOR_TEXT),
    offset,
    length,
    blockIndex: index,
    blockText: blockText.slice(0, MAX_CONTEXT),
  };
}

/** 把錨點對回目前的 DOM；文件改動太多、對不回來時回 null。 */
export function resolveDocxAnchor(
  root: HTMLElement | null,
  anchor: DocxBookmarkAnchor,
): BookmarkSpot | null {
  const blocks = docxBlocks(root);
  if (!blocks.length) {
    return null;
  }

  const wanted = normalizeText(anchor.blockText);
  const hinted = blocks[anchor.blockIndex];
  if (wanted) {
    if (hinted && fingerprintMatches(normalizeText(hinted.textContent ?? ""), wanted)) {
      return spotIn(hinted, anchor);
    }
    // 指紋對不上提示的位置時才整份掃描（常見情況在上面就結束了）。
    const texts = blocks.map((block) => normalizeText(block.textContent ?? ""));
    const byBlock = nearestIndex(texts.length, anchor.blockIndex, (index) =>
      fingerprintMatches(texts[index], wanted),
    );
    if (byBlock >= 0) {
      return spotIn(blocks[byBlock], anchor);
    }
    // 段落被改寫過：開頭還一樣就當成同一段。文件真的換了一大批內容時，
    // 這條仍然可能指到別段，所以標成「只跳區塊」——落地後畫面會立刻說明是哪一段。
    const byPrefix = nearestIndex(blocks.length, anchor.blockIndex, (index) =>
      prefixMatches(texts[index], wanted),
    );
    if (byPrefix >= 0) {
      return spotIn(blocks[byPrefix], anchor);
    }
  }
  if (!anchor.text) {
    return null;
  }
  const byText = nearestIndex(blocks.length, anchor.blockIndex, (index) =>
    (blocks[index].textContent ?? "").includes(anchor.text),
  );
  return byText >= 0 ? spotIn(blocks[byText], anchor, false) : null;
}

/**
 * 錨點在區塊裡的落點。
 *
 * `precise` 為 false（只有「選取的文字還在某處」這條線索）時只跳區塊不標示；
 * 其餘情況位移只有在「那個位置真的還是同一段文字」時才拿來標示，段落被改過就往
 * 區塊裡重新找一次選取的文字，再找不到就只跳到區塊。
 */
function spotIn(
  block: HTMLElement,
  anchor: DocxBookmarkAnchor,
  precise = true,
): BookmarkSpot {
  const text = block.textContent ?? "";
  const offset = Math.min(Math.max(0, Math.round(anchor.offset)), text.length);
  if (precise && anchor.text && text.slice(offset, offset + anchor.text.length) === anchor.text) {
    return { target: block, range: rangeAt(block, offset, anchor.text.length), flash: block };
  }
  const found = precise && anchor.text ? text.indexOf(anchor.text) : -1;
  if (found >= 0) {
    return { target: block, range: rangeAt(block, found, anchor.text.length), flash: block };
  }
  return { target: block, range: null, flash: block };
}
