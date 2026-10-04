/**
 * 文字寬度量測。
 *
 * 用一個延遲建立、**不插入 DOM** 的 canvas（2D `measureText`）取代逐一插入隱藏節點：
 * 兩萬筆項目也能在一次短暫計算內量完，且不會觸發版面重排。
 * 呼叫端負責給對 CSS font 字串（例如從 `getComputedStyle()` 拿到的整串字型設定）。
 */
let context: CanvasRenderingContext2D | null = null;

function measureContext(): CanvasRenderingContext2D | null {
  if (!context) {
    context = document.createElement("canvas").getContext("2d");
  }
  return context;
}

/** 指定字型下這段文字的寬度（px）；空字串或取不到 context 時回 0。 */
export function measureText(text: string, font: string): number {
  const ctx = measureContext();
  if (!ctx || !text) {
    return 0;
  }
  if (font) {
    ctx.font = font;
  }
  return ctx.measureText(text).width;
}

/** 這一組文字裡最寬的一個（px）；空陣列回 0。 */
export function widestText(texts: readonly string[], font: string): number {
  const ctx = measureContext();
  if (!ctx) {
    return 0;
  }
  if (font) {
    ctx.font = font;
  }
  let widest = 0;
  for (const text of texts) {
    if (!text) {
      continue;
    }
    const width = ctx.measureText(text).width;
    if (width > widest) {
      widest = width;
    }
  }
  return widest;
}
