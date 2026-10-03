import * as api from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { useClipboardStore } from "@/stores/clipboard";
import { useExplorerStore } from "@/stores/explorer";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import type { PaneId } from "@/types/fs";
import type { MenuItem } from "@/types/menu";
import type { ExternalTool, ToolVars } from "@/types/tools";
import { fileNameOf, fileStemOf, parentOf, samePath } from "@/utils/path";
import { splitIcon } from "@/utils/layout";
import { toolMatches } from "@/utils/tools";
import { applyVars, buildVars } from "@/utils/toolVars";

/** 右鍵選單的對象：檔案或資料夾，以及它自己的完整路徑。 */
export interface MenuTarget {
  path: string;
  isDir: boolean;
}

/**
 * 一次右鍵的完整情境。
 *
 * `target` 是右鍵的那一項；在清單空白處右鍵時帶入「目前資料夾」，而 `targets`
 * 是空的 —— 空白處代表沒有任何被選取的項目，選單只提供整組操作。
 * `targets` 則是這次動作實際會作用的項目：右鍵的項目若在選取範圍內就是整個選取，
 * 否則只有它自己（與檔案總管一致）。
 */
export interface MenuRequest {
  target: MenuTarget;
  targets: MenuTarget[];
}

/**
 * 右鍵選單的內容與動作。
 *
 * 選單依「選取的數量與種類」決定內容：單一資料夾給開啟、新增與貼上，單一檔案給
 * 開啟與外部工具，多選只留對整組有意義的動作。外部工具另外用使用者的設定
 * （顯示於檔案／資料夾、副檔名）篩選，規則見 `utils/tools.ts`。
 */
export function usePathMenu() {
  const explorer = useExplorerStore();
  const settings = useSettingsStore();
  const tabs = useTabsStore();
  const ui = useUiStore();
  const clipboard = useClipboardStore();

  function toVars(target: MenuTarget | null): ToolVars | null {
    if (!target?.path) {
      return null;
    }
    const fullFolderPath = target.isDir ? target.path : (parentOf(target.path) ?? target.path);
    const fileName = fileNameOf(target.path);
    return {
      fullFilePath: target.path,
      fullFolderPath,
      fileName,
      fileStem: fileStemOf(fileName),
      folderName: fileNameOf(fullFolderPath) || fullFolderPath,
    };
  }

  /** 目標（無後綴）＋ 左／上窗格（1）＋ 右／下窗格（2）。 */
  function varsFor(target: MenuTarget | null): Record<string, string> {
    const paneIds = tabs.activeTab?.paneIds ?? [];
    const paneVars = paneIds.map((id) => toVars(explorer.selectionTarget(id)));
    return buildVars(toVars(target), paneVars);
  }

  /** 由「右鍵的那一項」與該窗格的選取組出 request。 */
  function requestFor(paneId: PaneId, target: MenuTarget): MenuRequest {
    const selection = explorer.selectionTargets(paneId);
    const picked = selection.some((item) => samePath(item.path, target.path));
    return { target, targets: picked ? selection : [target] };
  }

  /** 清單空白處：對象是目前資料夾，但沒有任何被選取的項目。 */
  function blankRequest(folderPath: string): MenuRequest {
    return { target: { path: folderPath, isDir: true }, targets: [] };
  }

  function newItems(): MenuItem[] {
    return [
      { id: "new-folder", label: "建立新資料夾", icon: "folder", shortcut: "Ctrl+Shift+N" },
      { id: "new-file", label: "建立新檔案", icon: "file" },
    ];
  }

  function clipboardItems(kind: "file" | "folder" | "multi"): MenuItem[] {
    const items: MenuItem[] = [
      { id: "cut", label: "剪下", icon: "scissors", shortcut: "Ctrl+X" },
      { id: "copy", label: "複製", icon: "copy", shortcut: "Ctrl+C" },
    ];
    // 貼上只對「一個明確的目的地資料夾」有意義；多選時不知道要貼到哪一個。
    if (kind === "folder") {
      items.push({ id: "paste", label: "貼上", icon: "paste", shortcut: "Ctrl+V" });
    }
    items.push({ id: "delete", label: "刪除", icon: "trash", shortcut: "Del" });
    return items;
  }

  function pasteItem(): MenuItem {
    return { id: "paste", label: "貼上", icon: "paste", shortcut: "Ctrl+V" };
  }

  /** 外部工具：只留下對這組對象真正適用的。 */
  function toolItems(targets: MenuTarget[]): MenuItem[] {
    return settings.tools
      .filter((tool) => toolMatches(tool, targets))
      .map((tool) => ({ id: `tool:${tool.id}`, label: tool.label, icon: tool.icon }));
  }

  /** 只有分割時才提供的「送到另一邊」。 */
  function transferItems(): MenuItem[] {
    const tab = tabs.activeTab;
    if (!tab || !tabs.otherPaneId(tab)) {
      return [];
    }
    return [
      { id: "transfer-copy", label: "複製到另一窗格", icon: "paneCopy", shortcut: "Ctrl+Shift+C" },
      { id: "transfer-move", label: "移動到另一窗格", icon: "paneMove", shortcut: "Ctrl+Shift+M" },
    ];
  }

  function copyPathItems(): MenuItem[] {
    return [
      { id: "copy-windows", label: "複製路徑（Windows）", icon: "link" },
      { id: "copy-linux", label: "複製路徑（Linux）", icon: "link" },
    ];
  }

  function revealItem(label = "在檔案總管中顯示"): MenuItem {
    return { id: "reveal", label, icon: "externalLink" };
  }

  function append(items: MenuItem[], block: MenuItem[]) {
    block.forEach((item, index) => {
      items.push({ ...item, separatorBefore: index === 0 ? items.length > 0 : false });
    });
  }

  /** 空白處：只提供跟「目前這個資料夾」有關的動作，加上新增與貼上。 */
  function menuForBlank(target: MenuTarget): MenuItem[] {
    const items: MenuItem[] = [];
    append(items, newItems());
    append(items, [pasteItem()]);
    append(items, toolItems([target]));
    append(items, copyPathItems());
    append(items, [revealItem()]);
    return items;
  }

  /** 單一資料夾：可以進去、可以在裡面新增、也可以把它當貼上的目的地。 */
  function menuForFolder(target: MenuTarget): MenuItem[] {
    const items: MenuItem[] = [
      { id: "open", label: "開啟", icon: "folderOpen" },
      { id: "open-tab", label: "在新分頁開啟", icon: "tabNew" },
      {
        id: "open-pane",
        label: "在新窗格開啟",
        // 圖示直接反映會用哪個方向：沿用上次分割的方向（與工具列的記憶一致）。
        icon: splitIcon(settings.lastSplit.direction),
        // 已經分割的分頁再呼叫 split() 只會換方向，不會真的開新窗格，所以先擋住。
        disabled: tabs.isSplit,
      },
    ];
    append(items, newItems());
    append(items, clipboardItems("folder"));
    append(items, toolItems([target]));
    append(items, transferItems());
    append(items, copyPathItems());
    append(items, [revealItem()]);
    return items;
  }

  /** 單一檔案：沒有「新增」也沒有「貼上」，工具再依副檔名篩選。 */
  function menuForFile(target: MenuTarget): MenuItem[] {
    const items: MenuItem[] = [{ id: "open", label: "開啟", icon: "folderOpen" }];
    append(items, clipboardItems("file"));
    append(items, toolItems([target]));
    append(items, transferItems());
    append(items, copyPathItems());
    append(items, [revealItem()]);
    return items;
  }

  /**
   * 多選：只留下對「一整組」都成立的動作。
   *
   * 開啟、新增、貼上這類單一目標的動作都不出現；外部工具要整組都符合才會出現
   * （例如整組都是 .zip 時的 7-Zip）。
   */
  function menuForSelection(request: MenuRequest): MenuItem[] {
    const items: MenuItem[] = [];
    append(items, clipboardItems("multi"));
    append(items, toolItems(request.targets));
    append(items, transferItems());
    append(items, copyPathItems());
    append(items, [revealItem("在檔案總管中顯示右鍵的項目")]);
    return items;
  }

  function menuFor(request: MenuRequest): MenuItem[] {
    if (!request.targets.length) {
      return menuForBlank(request.target);
    }
    if (request.targets.length > 1) {
      return menuForSelection(request);
    }
    return request.targets[0].isDir
      ? menuForFolder(request.targets[0])
      : menuForFile(request.targets[0]);
  }

  /**
   * 執行外部工具。
   *
   * 多選時，單獨一行的 `$fullFilePath` 會展開成「每個選取項目一個引數」——
   * 這樣 7-Zip 這類吃多個檔案的指令才有意義；其他寫法（例如 `--file=$fullFilePath`）
   * 一律只代表右鍵的那一項。
   */
  async function runTool(tool: ExternalTool, request: MenuRequest) {
    const vars = varsFor(request.target);
    const program = applyVars(tool.executable, vars).trim();
    if (!program) {
      ui.showNotice(`「${tool.label}」還沒有設定執行檔`);
      return;
    }

    const paths = request.targets.map((item) => item.path);
    const args = tool.args.flatMap((arg) => {
      if (paths.length > 1 && arg.trim() === "$fullFilePath") {
        return paths;
      }
      // 變數取不到值時會展開成空字串，這種引數直接丟掉，不要送空引數給程式。
      const value = applyVars(arg, vars).trim();
      return value ? [value] : [];
    });
    const workingDirectory = applyVars(tool.workingDirectory, vars).trim();

    try {
      await api.runExternal(program, args, workingDirectory || null, tool.newConsole);
    } catch (cause) {
      ui.showNotice(normalizeBackendError(cause).message, undefined, 4200);
    }
  }

  /** 建立新項目：先問名稱，再交給後端；檔名預設只選取主檔名。 */
  async function createEntry(kind: "folder" | "file", target: MenuTarget) {
    const folder = target.isDir ? target.path : (parentOf(target.path) ?? "");
    if (!folder) {
      return;
    }

    const suggested = kind === "folder" ? "新增資料夾" : "新增文字文件.txt";
    const name = await ui.prompt({
      title: kind === "folder" ? "建立新資料夾" : "建立新檔案",
      label: "名稱",
      value: suggested,
      confirmText: "建立",
      // 只選取「新增文字文件」的部分，副檔名留著不要被覆蓋。
      selectTo: kind === "file" ? "新增文字文件".length : undefined,
    });
    if (!name) {
      return;
    }
    await explorer.createEntry(tabs.activePaneId, folder, name, kind);
  }

  async function run(id: string, request: MenuRequest) {
    const paneId = tabs.activePaneId;
    const { target } = request;
    // 空白處沒有被選取的項目時，動作的對象就是目前資料夾自己。
    const paths = request.targets.length
      ? request.targets.map((item) => item.path)
      : [target.path];

    if (id.startsWith("tool:")) {
      const tool = settings.tools.find((item) => item.id === id.slice(5));
      if (tool) {
        await runTool(tool, request);
      }
      return;
    }

    switch (id) {
      case "new-folder":
        await createEntry("folder", target);
        return;
      case "new-file":
        await createEntry("file", target);
        return;
      case "cut":
        await clipboard.put(paths, true);
        return;
      case "copy":
        await clipboard.put(paths, false);
        return;
      case "paste":
        await clipboard.paste(paneId, target.isDir ? target.path : undefined);
        return;
      case "delete":
        await clipboard.removePaths(paths);
        return;
      case "transfer-copy":
        await clipboard.transferToOtherPane("copy");
        return;
      case "transfer-move":
        await clipboard.transferToOtherPane("move");
        return;
      case "open":
        await explorer.openPath(target.path);
        return;
      case "open-tab":
        tabs.newTab(target.path);
        return;
      case "open-pane":
        tabs.split(settings.lastSplit.direction, target.path);
        return;
      case "copy-windows":
        await explorer.copyPaths(paths, "windows");
        return;
      case "copy-linux":
        await explorer.copyPaths(paths, "linux");
        return;
      case "reveal":
        await explorer.revealTarget(target.path);
        return;
      default:
        return;
    }
  }

  return { menuFor, requestFor, blankRequest, run };
}
