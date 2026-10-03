import type { ToolVars } from "@/types/tools";

/**
 * 外部工具樣板的可用變數。
 *
 * 沒有後綴＝右鍵點擊的那個目標；`1`＝左／上窗格、`2`＝右／下窗格。
 * 窗格沒有分割時，`2` 的變數會展開成空字串。
 */
export const TOOL_VARIABLES: { name: string; description: string }[] = [
  { name: "$fullFilePath", description: "選取項目的完整路徑" },
  { name: "$fullFolderPath", description: "該項目所在資料夾的完整路徑" },
  { name: "$fileName", description: "項目名稱（含副檔名）" },
  { name: "$fileStem", description: "項目名稱去掉副檔名（例如 archive.7z → archive）" },
  { name: "$folderName", description: "所在資料夾的名稱" },
  { name: "$fullFilePath1", description: "四種變數都可以加後綴 1＝左／上窗格、2＝右／下窗格" },
  { name: "$fullFilePath2", description: "取右／下窗格的選取項目（未分割時展開成空字串）" },
];

const PATTERN = /\$(fullFilePath|fullFolderPath|fileName|fileStem|folderName)([12])?/g;

/** 把樣板中的變數換成實際路徑；未知或取不到的變數會展開成空字串。 */
export function applyVars(template: string, vars: Record<string, string>): string {
  return template.replace(PATTERN, (_match, name: string, suffix: string | undefined) =>
    vars[suffix ? `${name}${suffix}` : name] ?? "",
  );
}

/** 沒有後綴的變數（右鍵目標）與 1／2（左／上、右／下窗格）攤平成一張表。 */
export function buildVars(
  target: ToolVars | null,
  panes: (ToolVars | null)[],
): Record<string, string> {
  const vars: Record<string, string> = {};
  const assign = (suffix: string, value: ToolVars | null) => {
    vars[`fullFilePath${suffix}`] = value?.fullFilePath ?? "";
    vars[`fullFolderPath${suffix}`] = value?.fullFolderPath ?? "";
    vars[`fileName${suffix}`] = value?.fileName ?? "";
    vars[`fileStem${suffix}`] = value?.fileStem ?? "";
    vars[`folderName${suffix}`] = value?.folderName ?? "";
  };

  assign("", target);
  assign("1", panes[0] ?? null);
  assign("2", panes[1] ?? null);
  return vars;
}
