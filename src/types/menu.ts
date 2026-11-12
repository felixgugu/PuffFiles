import type { IconName } from "@/components/common/icons";

/** 右鍵選單的一列。 */
export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  shortcut?: string;
  disabled?: boolean;
  /** 這一項之前畫一條分隔線。 */
  separatorBefore?: boolean;
  /**
   * 子選單內容。有值的列是「子選單入口」：滑過就展開，按下不會產生選取事件
   * （真正的事件一律由子選單裡的葉節點發出，id 與攤平時完全相同）。
   */
  children?: MenuItem[];
}
