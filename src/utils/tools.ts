import type { ExternalTool } from "@/types/tools";
import { extensionOf } from "@/utils/path";

/** 判斷工具適不適合時只需要這兩件事，不依賴選單的型別。 */
export interface ToolCandidate {
  path: string;
  isDir: boolean;
}

/** 把使用者輸入（空白、逗號、分號分隔）正規化成 `.7z` 這種小寫含點的形式。 */
export function normalizeExtensions(input: string): string[] {
  const result: string[] = [];
  for (const part of input.split(/[\s,;]+/)) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const value = (trimmed.startsWith(".") ? trimmed : `.${trimmed}`).toLocaleLowerCase();
    if (!result.includes(value)) {
      result.push(value);
    }
  }
  return result;
}

/** 正規化後的清單轉回可編輯的文字。 */
export function formatExtensions(extensions: string[] | undefined): string {
  return (extensions ?? []).join(" ");
}

/**
 * 這個工具該不該出現在這組對象的右鍵選單上。
 *
 * - 「顯示於」要涵蓋每一個對象：整組都是檔案就不會被資料夾工具篩掉，反之亦然
 * - 設了副檔名就只認檔案，而且整組都要符合（混合選取時寧可不顯示，不要給出
 *   只對其中幾個檔案有意義的選項）
 */
export function toolMatches(tool: ExternalTool, targets: ToolCandidate[]): boolean {
  if (!targets.length) {
    return false;
  }

  const hasFile = targets.some((target) => !target.isDir);
  const hasFolder = targets.some((target) => target.isDir);
  if (hasFile && !tool.targets.includes("file")) {
    return false;
  }
  if (hasFolder && !tool.targets.includes("folder")) {
    return false;
  }

  const extensions = tool.extensions ?? [];
  if (!extensions.length) {
    return true;
  }
  if (hasFolder) {
    return false;
  }
  return targets.every((target) => extensions.includes(extensionOf(target.path)));
}
