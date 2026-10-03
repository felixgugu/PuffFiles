import type { IconName } from "@/components/common/icons";

/** 這個工具要出現在哪一種右鍵選單。 */
export type ToolTarget = "file" | "folder";

/**
 * 使用者可自訂的外部工具。
 *
 * `executable`、`args`、`workingDirectory` 都支援樣板變數（見 `utils/toolVars.ts`），
 * 例如 `$fullFilePath`、`$fullFolderPath1`。
 */
export interface ExternalTool {
  id: string;
  /** 右鍵選單上顯示的名稱。 */
  label: string;
  /** 執行檔路徑或指令名稱（例如 `pwsh.exe`、`C:\tools\foo.exe`）。 */
  executable: string;
  /** 每個元素是一個引數；UI 上一行一個。 */
  args: string[];
  /** 工作目錄；留空表示沿用目前的行程目錄。 */
  workingDirectory: string;
  /** 終端機類工具要開新主控台視窗。 */
  newConsole: boolean;
  targets: ToolTarget[];
  icon: IconName;
  /** 內建工具可以編輯，但不能刪除。 */
  builtin?: boolean;
}

/** 供應給樣板變數的一組路徑資訊。 */
export interface ToolVars {
  fullFilePath: string;
  fullFolderPath: string;
  fileName: string;
  folderName: string;
}
