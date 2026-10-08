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
  /**
   * 只在這些副檔名上出現（含點、小寫，例如 `.7z`），不分大小寫比對。
   * 空陣列或未設定＝不限；一旦設定就只會出現在檔案上，資料夾不算符合。
   */
  extensions?: string[];
  icon: IconName;
  /** 內建工具可以編輯，但不能刪除。 */
  builtin?: boolean;
  /**
   * 開機時自動偵測執行檔的對象（目前只有 `"7zip"`）。
   * 偵測結果只會填進**空白**的執行檔，使用者自己填過的不會被蓋掉；
   * 執行檔空白的自動偵測工具不會出現在右鍵選單上。
   */
  autoDetect?: "7zip";
  /** 只在選取一個項目時出現（例如「加入到某個 zip」這種以單一項目命名結果的動作）。 */
  single?: boolean;
  /** 是否啟用（未設定＝啟用）；關掉就不會出現在右鍵選單。 */
  enabled?: boolean;
}

/** 供應給樣板變數的一組路徑資訊。 */
export interface ToolVars {
  fullFilePath: string;
  fullFolderPath: string;
  /** 上層資料夾：資料夾目標＝它的上層，檔案目標＝所在資料夾。 */
  parentFolderPath: string;
  fileName: string;
  /** 檔名去掉副檔名。 */
  fileStem: string;
  folderName: string;
}
