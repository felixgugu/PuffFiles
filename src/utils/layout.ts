import type { IconName } from "@/components/common/icons";
import type { SplitDirection } from "@/types/fs";

export interface LayoutShape {
  paneIds: unknown[];
  direction: SplitDirection;
}

/**
 * 版面的三種狀態各有專屬圖示，讓使用者在分頁列上一眼看出這個分頁的長相。
 *
 * - `layoutSingle`：一般（單一窗格）
 * - `splitColumns`：垂直分割（左右並排，中間是一條垂直分隔線）
 * - `splitRows`：水平分割（上下堆疊，中間是一條水平分隔線）
 */
export function layoutIcon(layout: LayoutShape): IconName {
  if (layout.paneIds.length < 2) {
    return "layoutSingle";
  }
  return layout.direction === "row" ? "splitColumns" : "splitRows";
}

export function layoutLabel(layout: LayoutShape): string {
  if (layout.paneIds.length < 2) {
    return "一般";
  }
  return layout.direction === "row" ? "垂直分割" : "水平分割";
}

/**
 * 窗格在版面中的位置標籤；未分割時為空字串。
 *
 * 依分割方向給出精確的說法：左右並排時是「左／右」，上下堆疊時是「上／下」。
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
