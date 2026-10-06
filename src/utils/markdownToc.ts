/**
 * 目錄索引浮動面板的幾何計算（無副作用純函數）。
 *
 * 面板用「左上角位移 + 寬高」描述自己的位置；`x === null` 代表還沒有被
 * 使用者移動過，維持右上角對齊。所有值在每次畫面更新時都會重新夾回邊界內，
 * 所以窗格變窄、分割比例改變或視窗縮小都不會讓面板跑到畫面外。
 *
 * 最小寬度與不透明度是使用者在設定頁調的偏好，這裡只負責合法範圍與夾邊界。
 */

/** 面板與檢視器邊界之間的留白。 */
export const TOC_MARGIN = 12;
/** 面板最小寬度（設定值）的預設、下限與上限。 */
export const TOC_MIN_WIDTH_DEFAULT = 200;
export const TOC_MIN_WIDTH_FLOOR = 160;
export const TOC_MIN_WIDTH_CEILING = 400;
export const TOC_DEFAULT_WIDTH = 320;
/** 面板底色不透明度（%）：越低越能看見底下的內文。 */
export const TOC_OPACITY_DEFAULT = 50;
export const TOC_OPACITY_MIN = 30;
export const TOC_OPACITY_MAX = 100;
/** 使用者拖曳能壓到的最小高度。 */
export const TOC_MIN_HEIGHT = 96;
/** 標題列高度；收合後面板就只剩這一段。 */
export const TOC_TITLEBAR_HEIGHT = 32;
/** 一列目錄項的估計高度，用來算自適應高度。 */
export const TOC_ROW_HEIGHT = 26;

export interface TocPanelLayout {
  /** 左上角 x（px）；`null`＝尚未移動，維持右上角對齊。 */
  x: number | null;
  y: number;
  width: number;
  /** `null`＝依內容自適應（上限為檢視器高度的一半）。 */
  height: number | null;
}

export interface TocBounds {
  width: number;
  height: number;
  /** 目錄清單的自然高度（標題列以外的內容）。 */
  contentHeight: number;
  /** 使用者設定的面板最小寬度（拖曳下限，也是自動隱藏的基準）。 */
  minWidth: number;
}

export interface TocRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clampTocMinWidth(value: number): number {
  return Math.min(Math.max(Math.round(value), TOC_MIN_WIDTH_FLOOR), TOC_MIN_WIDTH_CEILING);
}

export function clampTocOpacity(value: number): number {
  return Math.min(Math.max(Math.round(value), TOC_OPACITY_MIN), TOC_OPACITY_MAX);
}

/** 內容區夠不夠放得下「最小寬度 + 兩側留白」的面板。 */
export function tocPanelFits(areaWidth: number, minWidth: number): boolean {
  return areaWidth >= clampTocMinWidth(minWidth) + TOC_MARGIN * 2;
}

/**
 * 把面板位置與大小夾進可視範圍。
 *
 * 回傳 `null` 代表這個窗格太窄，這一輪不該顯示面板。
 */
export function clampTocPanel(layout: TocPanelLayout, bounds: TocBounds): TocRect | null {
  if (!tocPanelFits(bounds.width, bounds.minWidth) || bounds.height <= 0) {
    return null;
  }

  const minWidth = clampTocMinWidth(bounds.minWidth);
  const maxWidth = Math.max(minWidth, bounds.width - TOC_MARGIN * 2);
  const width = Math.min(Math.max(Math.round(layout.width), minWidth), maxWidth);

  const maxHeight = Math.max(TOC_MIN_HEIGHT, bounds.height - TOC_MARGIN * 2);
  const floor = layout.height === null ? TOC_TITLEBAR_HEIGHT + TOC_ROW_HEIGHT : TOC_MIN_HEIGHT;
  const natural =
    layout.height ?? Math.min(Math.max(bounds.contentHeight, floor), bounds.height * 0.5);
  const height = Math.min(Math.max(Math.round(natural), floor), maxHeight);

  const maxX = Math.max(0, bounds.width - width - TOC_MARGIN * 2);
  const maxY = Math.max(0, bounds.height - height - TOC_MARGIN * 2);
  const x = layout.x === null ? maxX : Math.min(Math.max(0, Math.round(layout.x)), maxX);
  const y = Math.min(Math.max(0, Math.round(layout.y)), maxY);

  return { x, y, width, height };
}
