/**
 * Mermaid 圖表尺寸：把 SVG 的 viewBox 調整到「蓋住真正畫出來的內容」。
 *
 * **為什麼不能只用 mermaid 給的 viewBox。** mermaid 產生的 viewBox 是
 * `(bbox.x - p) (bbox.y - p) (bbox.width + 2p) (bbox.height + 2p)`，`p` 是各圖表型別
 * 自己的 padding。示意圖（flowchart／class／state／er／mindmap…）的內容確實落在
 * `getBBox()` 的範圍裡，但**自己算尺寸的圖表型別不會**：gantt／pie／xychart／
 * quadrantChart／radar／packet 的標籤擺在作者算出來的位置，常常剛好貼在框邊、甚至
 * 落在框外（實測 radar 的軸標籤左右超出 17／29px、quadrantChart 的軸標籤超出 7px、
 * gantt 的「今天」標記線超出 33px）。`getBBox()` 也只看幾何聯集，stroke 與 marker
 * 不算在裡面。
 *
 * SVG 根元素預設 `overflow: hidden`，所以超出 viewBox 的內容不是溢出、而是**被裁掉**
 * ——使用者看到的就是「圖的右邊／下面被切掉」。這裡的作法是把 viewBox 往外擴到蓋住
 * 真正畫出來的範圍（只放大、不縮小），因此原本就正常的圖表尺寸完全不變。
 *
 * 這個檔案與 Vue／store 無關，`tools/mermaid-clip-check` 的量測工具直接 import 這支，
 * 驗的就是實際出貨的邏輯。
 */
import type { MermaidConfig } from "mermaid";

/**
 * 檢視器用的 mermaid 設定。
 *
 * 放在這裡而不是寫在 `useMarkdownMermaid` 裡，是為了讓量測工具（`tools/mermaid-clip-check`）
 * 與檢視器共用同一份設定 —— 兩邊各寫一次，改了一邊就會量到不一樣的圖。
 *
 * - `fontSize: 12`：圖表明顯更緊湊，窗格裡比較看得完整張圖（mermaid 會依它算行高）。
 * - `flowchart.wrappingWidth: 250`：標籤換行寬度，太寬會讓節點橫向爆開。
 * - `flowchart.diagramPadding: 8`：mermaid 預設值。留白交給 `.md-mermaid-view` 自己的
 *   內距，不需要在圖裡再留一次。
 */
export function mermaidConfig(isDark: boolean): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    suppressErrorRendering: true,
    theme: isDark ? "dark" : "default",
    look: "classic",
    fontFamily: 'var(--font-sans, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif)',
    fontSize: 12,
    flowchart: {
      htmlLabels: false,
      wrappingWidth: 250,
      diagramPadding: 8,
      nodeSpacing: 24,
      rankSpacing: 24,
    },
    sequence: {
      diagramMarginX: 24,
      diagramMarginY: 24,
    },
  };
}

/** 真正畫得出東西的節點；`<g>` 只是聚合子節點，逐一量沒有額外資訊。 */
const CONTENT_SELECTOR =
  "path, rect, circle, ellipse, line, polyline, polygon, text, tspan, image, foreignObject, use";

/**
 * 這些子樹裡的東西不是「圖表的內容」：
 *
 * - 定義區（defs／clipPath／mask／marker／pattern）只是被引用，本身不畫在圖上。
 * - gantt 的「今天」標記線（`.today`）是 mermaid 自己畫在圖表區間外的裝飾：今天的
 *   日期不在圖表的日期範圍裡時，那條線會落在離圖表很遠的地方（實測 2000px 以上）。
 *   官方 viewer 也是把它裁掉，算進來只會讓圖表平白多出一大片空白。
 */
const SKIPPED_SELECTOR = "defs, clipPath, mask, marker, pattern, style, title, desc, .today";

export interface DiagramBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 圖表內容實際佔用的範圍（viewBox 座標）；量不到時回 `null`。
 *
 * 量不到的情況有兩種：SVG 不在畫面上（`display: none` 的子樹拿不到
 * `getScreenCTM()`，例如還停在「顯示原始碼」的圖表），或是圖表裡沒有任何畫得出來的
 * 節點。兩者都交給呼叫端退回 mermaid 原本的 viewBox。
 *
 * 元素自己的 transform（例如轉了 90 度的軸標籤）已經反映在畫面矩形上，把四個角換算
 * 回 viewBox 座標就是保守的上界；文字量到的是行框而不是墨跡，會比實際多留一點，
 * 這個方向是安全的。
 */
export function diagramContentBounds(svg: SVGSVGElement): DiagramBounds | null {
  const toUser = svg.getScreenCTM()?.inverse();
  if (!toUser) {
    return null;
  }

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const element of svg.querySelectorAll<SVGGraphicsElement>(CONTENT_SELECTOR)) {
    if (element.closest(SKIPPED_SELECTOR)) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      continue;
    }
    for (const [clientX, clientY] of [
      [rect.left, rect.top],
      [rect.right, rect.top],
      [rect.left, rect.bottom],
      [rect.right, rect.bottom],
    ]) {
      const point = new DOMPoint(clientX, clientY).matrixTransform(toUser);
      left = Math.min(left, point.x);
      top = Math.min(top, point.y);
      right = Math.max(right, point.x);
      bottom = Math.max(bottom, point.y);
    }
  }

  if (left === Infinity) {
    return null;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * 把圖表調成 mermaid 算出的自然尺寸，並且保證內容不會被 viewBox 裁掉。
 *
 * mermaid 預設輸出 `width="100%"` 加上 inline `max-width`（＝自然寬度）：窗格比圖窄時
 * 整張圖會被等比縮小，愈縮愈長也愈難讀。這裡把 `width`／`height` 寫成內在尺寸、拿掉
 * inline `max-width`，超出的部分交給容器自己的捲軸處理；因為寫死的是自然尺寸，比窗格
 * 小的圖也不會被放大。
 *
 * **viewBox 不可以歸零。** 改寫成 `0 0 w h` 尺寸雖然不變，卻等於把可見視窗往右下推
 * `(p - bbox.x, p - bbox.y)`，內容 inset 大於 `2p` 時就切掉右緣與下緣。這裡的作法是
 * 「原點與尺寸都以 mermaid 的為底，再往外擴到蓋住真正畫出來的內容」——只放大、不縮小。
 *
 * 呼叫時機很重要：`getScreenCTM()` 對 `display: none` 的內容回 `null`，所以必須在
 * **圖表可見之後**呼叫（外殼建立時圖表區是隱藏的）。
 */
export function fitDiagramToContent(svg: SVGSVGElement): void {
  const box = svg.viewBox.baseVal;
  if (!box || box.width <= 0 || box.height <= 0) {
    return;
  }

  const content = diagramContentBounds(svg);
  const left = content ? Math.min(box.x, content.x) : box.x;
  const top = content ? Math.min(box.y, content.y) : box.y;
  const right = content ? Math.max(box.x + box.width, content.x + content.width) : box.x + box.width;
  const bottom = content
    ? Math.max(box.y + box.height, content.y + content.height)
    : box.y + box.height;
  const width = right - left;
  const height = bottom - top;

  if (width > box.width || height > box.height) {
    svg.setAttribute("viewBox", `${left} ${top} ${width} ${height}`);
  }
  svg.setAttribute("width", String(Math.round(width)));
  svg.setAttribute("height", String(Math.round(height)));
  // inline `max-width` 會蓋掉 CSS 的尺寸規則，一定要移除。
  svg.style.removeProperty("max-width");
  svg.style.removeProperty("width");
  svg.style.removeProperty("height");
}
