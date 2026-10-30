import { normalizeKey, parentOf, samePath, toBackslashes } from "@/utils/path";

/**
 * 拖曳移動的判斷邏輯（與 Vue、DOM 無關，見 AGENTS.md「檔案拖曳移動」）。
 *
 * 對標 Windows 檔案總管：同磁碟機拖曳＝移動、跨磁碟機＝複製；按住 Ctrl 強制複製、
 * Shift 強制移動。真的檔案操作仍交給 `IFileOperation`（衝突、進度、取消、Ctrl+Z）。
 */

/** 放開滑鼠時要做的動作。 */
export type DragEffect = "move" | "copy" | "none";

/** 拖曳當下的修飾鍵：Ctrl＝複製、Shift＝移動，都沒按就照磁碟機判斷。 */
export type DragModifier = "none" | "copy" | "move";

export interface DropPlan {
  effect: DragEffect;
  /** 不動作的原因（顯示在拖曳殘影上，也決定游標）。 */
  reason?: string;
  /** 不動作的分類：同一資料夾用一般游標，拖進自己才用 `not-allowed`。 */
  reject?: "same-folder" | "inside-self";
}

/** 路徑所在的磁碟機或網路分享根（`C:\`、`\\server\share\`）；不是絕對路徑時回 null。 */
export function volumeRootOf(path: string): string | null {
  const normalized = toBackslashes(path);
  const unc = /^\\\\([^\\]+)\\([^\\]+)/.exec(normalized);
  if (unc) {
    return `\\\\${unc[1]}\\${unc[2]}\\`;
  }
  const drive = /^([a-zA-Z]):/.exec(normalized);
  return drive ? `${drive[1].toUpperCase()}:\\` : null;
}

/** 兩個路徑是否在同一個磁碟機／網路分享上（磁碟機代號不分大小寫）。 */
export function sameVolume(a: string, b: string): boolean {
  const left = volumeRootOf(a);
  const right = volumeRootOf(b);
  return !!left && left === right;
}

/**
 * `child` 是否就是 `parent`，或位在它底下。
 *
 * 用來擋「把資料夾拖進它自己」—— IFileOperation 會拒絕，但先擋掉才不會閃出錯誤對話框。
 * 邊界用 `\` 比對，`C:\ab` 不會被當成 `C:\a` 的子孫。
 */
export function isWithinOrSelf(child: string, parent: string): boolean {
  const base = normalizeKey(parent);
  const target = normalizeKey(child);
  if (!base) {
    return false;
  }
  return target === base || target.startsWith(`${base}\\`);
}

/** 依修飾鍵與磁碟機決定效果：Ctrl＝複製、Shift＝移動、其餘照磁碟機。 */
export function dragEffectFor(
  modifiers: DragModifier,
  source: string,
  destination: string,
): DragEffect {
  if (modifiers === "copy") {
    return "copy";
  }
  if (modifiers === "move") {
    return "move";
  }
  return sameVolume(source, destination) ? "move" : "copy";
}

/**
 * 這次放開能不能動作、要做什麼。
 *
 * `sources` 是這次拖曳的完整路徑；全部已經在目的資料夾、或目的資料夾在某個被拖曳的
 * 資料夾裡面時回 `none`（不顯示高亮、不做任何事）。
 */
export function planDrop(
  sources: string[],
  destination: string,
  modifiers: DragModifier = "none",
): DropPlan {
  if (sources.length === 0 || !destination) {
    return { effect: "none" };
  }
  if (sources.every((source) => samePath(parentOf(source) ?? "", destination))) {
    return {
      effect: "none",
      reason: "項目已經在這個資料夾裡",
      reject: "same-folder",
    };
  }
  for (const source of sources) {
    if (isWithinOrSelf(destination, source)) {
      return {
        effect: "none",
        reason: "不能把資料夾放到它自己裡面",
        reject: "inside-self",
      };
    }
  }
  const origin = parentOf(sources[0]) ?? sources[0];
  return { effect: dragEffectFor(modifiers, origin, destination) };
}
