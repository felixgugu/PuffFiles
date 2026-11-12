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

/** 一組共用同一個群組名稱的工具；`group` 是空字串代表沒有設定群組。 */
export interface ToolGroupBucket<T> {
  group: string;
  tools: T[];
}

/**
 * 依 `group` 把工具分組，供右鍵選單組成子選單。
 *
 * - 群組的位置＝該群組**第一個**成員在清單裡的位置，組內維持原本順序；沒群組的工具
 *   自成一個只有一項的分組，因此呼叫端可以用同一套迴圈處理。
 * - 名稱比對忽略前後空白與大小寫（`7-Zip`／`7-zip` 視為同一個群組），顯示用第一次
 *   出現的那種寫法 —— 兩個只差大小寫的群組並存只會讓人以為設定沒生效。
 */
export function groupTools<T extends { group?: string }>(tools: T[]): ToolGroupBucket<T>[] {
  const buckets: ToolGroupBucket<T>[] = [];
  const byKey = new Map<string, ToolGroupBucket<T>>();

  for (const tool of tools) {
    const name = tool.group?.trim() ?? "";
    if (!name) {
      buckets.push({ group: "", tools: [tool] });
      continue;
    }
    const key = name.toLocaleLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      existing.tools.push(tool);
      continue;
    }
    const bucket: ToolGroupBucket<T> = { group: name, tools: [tool] };
    byKey.set(key, bucket);
    buckets.push(bucket);
  }

  return buckets;
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

  // 停用、只在單選出現卻選了一堆、以及還沒偵測到執行檔的自動偵測工具都不顯示。
  if (tool.enabled === false) {
    return false;
  }
  if (tool.single && targets.length > 1) {
    return false;
  }
  if (tool.autoDetect && !tool.executable.trim()) {
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
