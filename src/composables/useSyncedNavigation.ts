import * as api from "@/services/api";
import { useExplorerStore } from "@/stores/explorer";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import type { FileEntry, PaneId } from "@/types/fs";
import { joinPath, parentOf, samePath, stepsUp } from "@/utils/path";

/**
 * 同步瀏覽（見 §同步瀏覽與目錄比對）。
 *
 * 只鏡射「相對移動」：進入同名的子資料夾、上一層、點麵包屑的上層片段。輸入絕對路徑、
 * 資料夾樹、歷史面板與檢視器內的連結都是「跳到某個位置」，用相對名稱對應只會猜錯，
 * 因此一律只動焦點窗格。
 *
 * 順序是「焦點窗格先真的移動成功，另一邊才跟」：焦點窗格進不去（權限、被刪掉）時，
 * 另一邊不該跟著跑掉。另一邊沒有同名資料夾時只發通知、完全不動它，也不在磁碟上
 * 建立任何東西。
 */
export function useSyncedNavigation() {
  const explorer = useExplorerStore();
  const settings = useSettingsStore();
  const tabs = useTabsStore();
  const ui = useUiStore();

  /** 同一個分頁的另一個窗格；沒開同步或沒分割時回 null。 */
  function siblingPane(paneId: PaneId): PaneId | null {
    if (!settings.syncBrowsing) {
      return null;
    }
    const tab = tabs.activeTab;
    if (!tab || tab.paneIds.length < 2 || !tab.paneIds.includes(paneId)) {
      return null;
    }
    return tab.paneIds.find((id) => id !== paneId) ?? null;
  }

  /**
   * 另一個窗格目前這個資料夾裡，有沒有叫做 `name` 的**資料夾**。
   *
   * 先看它已經載入的完整清單（畫面被搜尋篩選過，不能拿可見清單判斷）；清單還沒載完
   * 才問後端一次 —— 直接嘗試導覽會讓另一邊閃出錯誤畫面，還可能把它的檢視器關掉。
   */
  async function hasSubdir(paneId: PaneId, name: string): Promise<boolean> {
    const pane = explorer.meta(paneId);
    if (!pane?.currentPath) {
      return false;
    }
    if (pane.status === "ready") {
      const key = name.toLocaleLowerCase();
      return explorer
        .entries(paneId)
        .some((item) => item.isDir && item.name.toLocaleLowerCase() === key);
    }
    const subdirs = await api.listSubdirs(pane.currentPath);
    return subdirs.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  }

  /** 另一邊沒有這個資料夾時的通知；兩邊都要看得懂是哪一邊沒跟上。 */
  function warnMissing(name: string) {
    ui.showNotice(`另一邊沒有「${name}」資料夾，只有這個窗格移動`, undefined, 3200);
  }

  function warnRoot() {
    ui.showNotice("另一邊已經在磁碟根目錄，只有這個窗格往上", undefined, 3200);
  }

  /** 讓另一邊進入同名的子資料夾；跟不到就只通知。 */
  async function mirrorChild(paneId: PaneId, name: string) {
    const other = siblingPane(paneId);
    const otherPath = other ? (explorer.meta(other)?.currentPath ?? "") : "";
    if (!other || !otherPath || !name) {
      return;
    }
    if (!(await hasSubdir(other, name))) {
      warnMissing(name);
      return;
    }
    await explorer.navigate(other, joinPath(otherPath, name));
  }

  /** 讓另一邊往上同樣的層數；層數不夠（已經在根目錄）就只通知。 */
  async function mirrorUp(paneId: PaneId, steps: number) {
    const other = siblingPane(paneId);
    let target = other ? (explorer.meta(other)?.currentPath ?? "") : "";
    if (!other || !target || steps <= 0) {
      return;
    }
    for (let index = 0; index < steps && target; index += 1) {
      target = parentOf(target) ?? "";
    }
    if (!target) {
      warnRoot();
      return;
    }
    await explorer.navigate(other, target);
  }

  /** 雙擊或 Enter：資料夾進去了才讓另一邊跟著進同名資料夾；檔案不受影響。 */
  async function open(paneId: PaneId, entry: FileEntry | null): Promise<void> {
    await explorer.activate(paneId, entry);
    if (!entry?.isDir) {
      return;
    }
    if (!samePath(explorer.meta(paneId)?.currentPath ?? "", entry.path)) {
      return;
    }
    await mirrorChild(paneId, entry.name);
  }

  /** 上一層（Backspace、路徑列的上一層鈕）。 */
  async function up(paneId: PaneId): Promise<void> {
    const before = explorer.meta(paneId)?.currentPath ?? "";
    await explorer.goUp(paneId);
    const after = explorer.meta(paneId)?.currentPath ?? "";
    if (!before || samePath(before, after)) {
      return;
    }
    await mirrorUp(paneId, 1);
  }

  /**
   * 跳到上層的某個資料夾（麵包屑片段）：換算成「往上幾層」再鏡射，
   * 兩邊深度不同時也各自回到對應的那一層。
   */
  async function toAncestor(paneId: PaneId, target: string): Promise<void> {
    const steps = stepsUp(explorer.meta(paneId)?.currentPath ?? "", target);
    await explorer.navigate(paneId, target);
    if (steps === null || steps === 0) {
      return;
    }
    if (!samePath(explorer.meta(paneId)?.currentPath ?? "", target)) {
      return;
    }
    await mirrorUp(paneId, steps);
  }

  return { open, up, toAncestor };
}
