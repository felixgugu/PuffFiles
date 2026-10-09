/**
 * 檢視器標頭的寬度預算（無副作用純函數）。
 *
 * 標頭右側的動作分成四顆膠囊：捲動／檢視器／檔案動作／窗格。窗格最窄可以縮到
 * 工作區寬度的 20%，塞不下時依序收起次要的 —— 先捲動、再檔案動作；搜尋、目錄索引
 * 與關閉在極窄窗格仍然要按得到，所以那兩顆永遠保留。
 *
 * 這裡用常數估算而不是量 DOM：按鈕與間距都是固定 px（不受字級設定影響），
 * 只有檔名會壓縮，所以估算結果與實際排版一致，也不必額外掛觀察器。
 */

/** 標頭左右內距（`px-2`）。 */
export const HEADER_PADDING = 16;
/** 左側「圖示＋檔名」至少留的寬度（檔名可以截斷到很短，但不能完全消失）。 */
export const HEADER_LEADING = 83;
/** 膠囊裡的按鈕邊長。 */
export const CAPSULE_BUTTON = 24;
/** 膠囊自己的內距（`p-0.5` 左右各 2px）。 */
export const CAPSULE_PADDING = 4;
/** 同一顆膠囊裡按鈕之間的距離（`gap-0.5`）。 */
export const CAPSULE_GAP = 2;
/** 膠囊與膠囊之間的距離（`gap-1`）。 */
export const CAPSULE_SPACING = 4;
/** 捲動膠囊的按鈕數（最上面／上一頁／下一頁／最下面）。 */
export const SCROLL_BUTTONS = 4;
/** 窗格膠囊的按鈕數（放到最大／關閉）。 */
export const PANE_BUTTONS = 2;

/** 一顆膠囊的外觀寬度（按鈕數 → px）。 */
export function capsuleWidth(buttons: number): number {
  if (buttons <= 0) {
    return 0;
  }
  return buttons * CAPSULE_BUTTON + (buttons - 1) * CAPSULE_GAP + CAPSULE_PADDING;
}

export interface ViewerHeaderFit {
  /** 捲動膠囊要不要顯示（這個檢視器本來就沒有捲動容器時一律 false）。 */
  scroll: boolean;
  /** 檔案動作膠囊要不要顯示。 */
  file: boolean;
}

export interface ViewerHeaderInput {
  /** 窗格目前寬度。 */
  paneWidth: number;
  /** 這個檢視器有沒有捲動容器（圖片的 false 會讓捲動膠囊直接不列入計算）。 */
  scroll: boolean;
  /** 檢視器膠囊的按鈕數（沒有就 0）。 */
  viewer: number;
  /** 檔案動作膠囊的按鈕數。 */
  file: number;
}

/**
 * 這一個寬度放得下哪幾顆膠囊。
 *
 * 依序試三種組合：全部 → 收起捲動 → 再收起檔案動作。三種都塞不下就回最後一種
 * （讓它自然溢出，與膠囊化之前一樣）。
 */
export function viewerHeaderFit(input: ViewerHeaderInput): ViewerHeaderFit {
  const available = Math.max(0, input.paneWidth - HEADER_PADDING - HEADER_LEADING);
  const viewer = capsuleWidth(input.viewer);
  const file = capsuleWidth(input.file);
  const pane = capsuleWidth(PANE_BUTTONS);
  const scroll = input.scroll ? capsuleWidth(SCROLL_BUTTONS) : 0;

  const fits = (widths: number[]) => {
    const visible = widths.filter((width) => width > 0);
    const total =
      visible.reduce((sum, width) => sum + width, 0) + Math.max(0, visible.length - 1) * CAPSULE_SPACING;
    return total <= available;
  };

  if (fits([scroll, viewer, file, pane])) {
    return { scroll: input.scroll, file: true };
  }
  if (fits([0, viewer, file, pane])) {
    return { scroll: false, file: true };
  }
  return { scroll: false, file: false };
}
