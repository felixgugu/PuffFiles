/**
 * 把一段 DOM 裡的「可見文字」串成純文字（搜尋與複製共用）。
 *
 * 檢視器的內容有三種來源：`v-html` 渲染後的 Markdown、排版後的 DOCX、以及
 * iframe 裡的 HTML 預覽。搜尋與「複製可見文字」要看的都是同一份東西 ——
 * 畫面上真正看得到的文字節點 —— 所以走訪只有這一份實作，
 * 兩邊拿到的字串逐字相同（搜尋另外需要位移表，把命中對回 DOM）。
 */

/** 這些節點裡的文字不算內容（iframe 的樣式與標題、被移除的腳本等）。 */
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "HEAD", "TITLE", "NOSCRIPT", "LINK"]);

/**
 * 區塊元素：換一個區塊就在文字裡補一個換行。
 *
 * 渲染後的 HTML（Markdown／HTML 預覽）節點之間沒有空白，整份文件的文字會黏成
 * 一大串 —— 命中片段會跨過好幾個段落、行號也沒有意義。補上換行之後，片段
 * 只會取到附近的內容，`lineText` 也剛好等於「命中所在的那個區塊」；
 * 複製出來的文字同樣以區塊為行。
 * 換行不屬於任何文字節點，所以位移對照表仍然精確。
 */
const BLOCK_SELECTOR =
  "p,h1,h2,h3,h4,h5,h6,li,ul,ol,div,pre,blockquote,table,tr,td,th,figure,figcaption,section,article,header,footer,dt,dd";

/** 一段文字節點在整份文字裡的範圍（搜尋要用它把命中位置對回 DOM）。 */
export interface TextSlice {
  node: Text;
  start: number;
  end: number;
}

export interface VisibleText {
  text: string;
  slices: TextSlice[];
}

/**
 * 走訪 `root` 底下的可見文字節點，串成一份文字並記下每一段的位移。
 *
 * 位移一律是 UTF-16 code unit，與 `utils/textSearch.ts` 的座標系相同；
 * 被標為 `data-search-skip` 的子樹（例如 Mermaid 圖表模式下收起的原始碼）
 * 不算內容。複製只讀 `text`，搜尋兩者都要。
 */
export function collectTextNodes(root: HTMLElement): VisibleText {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const slices: TextSlice[] = [];
  let text = "";
  let block: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName)) {
      continue;
    }
    if (parent.closest("[data-search-skip]")) {
      continue;
    }
    const value = (node as Text).data;
    if (!value) {
      continue;
    }
    const nextBlock = parent.closest(BLOCK_SELECTOR);
    if (text && nextBlock && nextBlock !== block) {
      text += "\n";
    }
    block = nextBlock;
    slices.push({ node: node as Text, start: text.length, end: text.length + value.length });
    text += value;
  }
  return { text, slices };
}

/** 只取文字（「複製可見文字」用的那一半）。 */
export function visibleTextOf(root: HTMLElement): string {
  return collectTextNodes(root).text;
}
