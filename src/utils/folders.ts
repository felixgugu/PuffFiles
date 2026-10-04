import type { FolderNode } from "@/types/fs";
import { fileNameOf } from "@/utils/path";

/** 別名顯示名稱的預設格式；模板留空時退回這個。 */
export const DEFAULT_ALIAS_TEMPLATE = "$aliasName-$RealFolderName";

/**
 * 把模板中的變數換成實際值。變數不分大小寫；未知的 `$token` 原樣保留。
 * 用函式型替換而不是字串，別名裡若有 `$&` 之類的字元才不會被當成替換語法。
 */
export function applyAliasTemplate(alias: string, realName: string, template: string): string {
  const format = template.trim() || DEFAULT_ALIAS_TEMPLATE;
  return format
    .replace(/\$aliasName/gi, () => alias)
    .replace(/\$realFolderName/gi, () => realName);
}

/**
 * 左側清單要顯示的名稱。
 *
 * 沒有別名（或不是真實資料夾）時就是原本的 `label`；有別名才套用格式，
 * 置換後為空白時也退回 `label`，避免節點變成看不到字的一列。
 */
export function folderDisplayName(node: FolderNode, template = ""): string {
  const alias = (node.alias ?? "").trim();
  if (node.kind !== "folder" || !alias) {
    return node.label;
  }
  const realName = fileNameOf(node.path ?? "") || node.label;
  return applyAliasTemplate(alias, realName, template).trim() || node.label;
}
