import type { IconName } from "@/components/common/icons";
import type { SplitDirection } from "@/types/fs";

export interface LayoutShape {
  paneIds: unknown[];
  direction: SplitDirection;
}

/**
 * 版面的三種狀態各有專屬圖示，讓使用者在分頁列上一眼看出這個分頁的長相。
 *
 * 名稱依 AGENTS.md「版面區塊與命名用語」，一律以窗格排列方向命名：
 * - `layoutSingle`：單一窗格
 * - `splitColumns`：左右分割（中間是一條垂直分隔線）
 * - `splitRows`：上下分割（中間是一條水平分隔線）
 */
/** 分割方向對應的圖示：`row` 是左右分割，`column` 是上下分割。 */
export function splitIcon(direction: SplitDirection): IconName {
  return direction === "row" ? "splitColumns" : "splitRows";
}

/** 交換窗格的圖示：方向跟著分割方向，左右是 ⇄、上下是 ⇅。 */
export function swapIcon(direction: SplitDirection): IconName {
  return direction === "row" ? "swapColumns" : "swapRows";
}

export function layoutIcon(layout: LayoutShape): IconName {
  if (layout.paneIds.length < 2) {
    return "layoutSingle";
  }
  return splitIcon(layout.direction);
}

export function layoutLabel(layout: LayoutShape): string {
  if (layout.paneIds.length < 2) {
    return "單一窗格";
  }
  return layout.direction === "row" ? "左右分割" : "上下分割";
}

/**
 * 窗格在版面中的位置標籤；未分割時為空字串。
 *
 * 依分割方向給出精確的說法：左右分割時是「左／右」，上下分割時是「上／下」。
 */
export function paneSlotLabel(layout: LayoutShape, paneId: string): string {
  if (layout.paneIds.length < 2) {
    return "";
  }
  const first = layout.paneIds.indexOf(paneId) === 0;
  if (layout.direction === "row") {
    return first ? "左" : "右";
  }
  return first ? "上" : "下";
}
