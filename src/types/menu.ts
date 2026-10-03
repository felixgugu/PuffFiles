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
}
