import * as api from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { useClipboardStore } from "@/stores/clipboard";
import { useExplorerStore } from "@/stores/explorer";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import type { MenuItem } from "@/types/menu";
import type { ExternalTool, ToolVars } from "@/types/tools";
import { fileNameOf, fileStemOf, parentOf, samePath } from "@/utils/path";
import { paneSlotLabel, splitIcon } from "@/utils/layout";
import { toolMatches } from "@/utils/tools";
import { applyVars, buildVars } from "@/utils/toolVars";
import { viewerKindOfPath } from "@/utils/viewer";

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
  /** 這個選單是「哪個窗格」開的；分割模式下決定會開到哪一邊。 */
  paneId: PaneId;
  target: MenuTarget;
  targets: MenuTarget[];
}

/**
 * 選單的可選區塊。
 *
 * 檔案清單預設不顯示剪貼與重新命名，只有按住 Shift 右鍵的「擴充選單」才出現；
 * 左側資料夾樹沒有就地編輯，所以固定顯示剪貼組、不顯示重新命名。
 */
export interface MenuOptions {
  /** 顯示「剪下／複製／貼上／刪除」這一組。 */
  clipboard?: boolean;
  /** 顯示「重新命名」（只有檔案清單能就地編輯）。 */
  rename?: boolean;
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
  const viewer = useViewerStore();

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
    return { paneId, target, targets: picked ? selection : [target] };
  }

  /** 清單空白處：對象是目前資料夾，但沒有任何被選取的項目。 */
  function blankRequest(paneId: PaneId, folderPath: string): MenuRequest {
    return { paneId, target: { path: folderPath, isDir: true }, targets: [] };
  }

  /**
   * 相對某個窗格的「另一個窗格」；未分割時回 `null`。
   *
   * 每分頁最多兩個窗格，所以非自己的那一個就是鄰居；它實際在左／右／上／下
   * 由 `paneSlotLabel()` 依分割方向算出來，說法與狀態列、路徑列的位置標籤一致。
   */
  function neighborPaneId(paneId: PaneId): PaneId | null {
    const tab = tabs.activeTab;
    // 選單開著時窗格被收掉（`paneId` 已不在版面上）就當成未分割，走原本的新窗格路徑。
    if (!tab || !tab.paneIds.includes(paneId)) {
      return null;
    }
    return tab.paneIds.find((id) => id !== paneId) ?? null;
  }

  function newItems(): MenuItem[] {
    return [
      { id: "new-folder", label: "建立新資料夾", icon: "folder", shortcut: "Ctrl+Shift+N" },
      { id: "new-file", label: "建立新檔案", icon: "file" },
    ];
  }

  /**
   * 剪貼與編輯項目：剪下／複製／貼上／重新命名／刪除。
   *
   * 這一整組預設不出現，由 `MenuOptions` 決定要不要加入。「貼上」只對一個明確的
   * 目的地資料夾有意義（多選時不知道要貼到哪一個，空白處則只留貼上）；
   * 「重新命名」只有能就地編輯的檔案清單提供，而且一次只改一個。
   */
  function editItems(
    kind: "file" | "folder" | "multi" | "blank",
    options: MenuOptions,
  ): MenuItem[] {
    // 空白處沒有任何被選取的項目，剪下／複製／刪除會作用在「目前這個資料夾本身」——
    // 那與檔案總管不同，刪除更是容易誤刪整個資料夾，所以只留下「貼到這裡」。
    if (kind === "blank") {
      return [{ id: "paste", label: "貼上", icon: "paste", shortcut: "Ctrl+V" }];
    }
    const items: MenuItem[] = [
      { id: "cut", label: "剪下", icon: "scissors", shortcut: "Ctrl+X" },
      { id: "copy", label: "複製", icon: "copy", shortcut: "Ctrl+C" },
    ];
    if (kind === "folder") {
      items.push({ id: "paste", label: "貼上", icon: "paste", shortcut: "Ctrl+V" });
    }
    if (options.rename && (kind === "file" || kind === "folder")) {
      items.push({ id: "rename", label: "重新命名", icon: "pencil", shortcut: "F2" });
    }
    items.push({ id: "delete", label: "刪除", icon: "trash", shortcut: "Del" });
    return items;
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

  /** 空白處：只提供跟「目前這個資料夾」有關的動作，加上新增（貼上屬於擴充選單）。 */
  function menuForBlank(target: MenuTarget, options: MenuOptions): MenuItem[] {
    const items: MenuItem[] = [];
    append(items, newItems());
    if (options.clipboard) {
      append(items, editItems("blank", options));
    }
    append(items, toolItems([target]));
    append(items, copyPathItems());
    append(items, [revealItem()]);
    return items;
  }

  /** 單一資料夾：可以進去、可以在裡面新增、也可以把它當貼上的目的地。 */
  function menuForFolder(target: MenuTarget, paneId: PaneId, options: MenuOptions): MenuItem[] {
    // 分割時直接說出會開到哪一邊；單一窗格時沿用上次分割的方向（與路徑列的版面切換一致）。
    const neighbor = neighborPaneId(paneId);
    const tab = tabs.activeTab;
    const items: MenuItem[] = [
      { id: "open", label: "開啟", icon: "folderOpen" },
      { id: "open-tab", label: "在新分頁開啟", icon: "tabNew" },
      {
        id: "open-pane",
        label: neighbor && tab ? `在${paneSlotLabel(tab, neighbor)}窗格開啟` : "在新窗格開啟",
        // 圖示直接反映會用哪個方向：沿用上次分割的方向（與路徑列的版面切換一致）。
        icon: splitIcon(neighbor && tab ? tab.direction : settings.lastSplit.direction),
      },
    ];
    append(items, newItems());
    if (options.clipboard) {
      append(items, editItems("folder", options));
    }
    append(items, toolItems([target]));
    append(items, transferItems());
    append(items, copyPathItems());
    append(items, [revealItem()]);
    return items;
  }

  /** 單一檔案：沒有「新增」也沒有「貼上」，工具再依副檔名篩選。 */
  function menuForFile(target: MenuTarget, paneId: PaneId, options: MenuOptions): MenuItem[] {
    const items: MenuItem[] = [{ id: "open", label: "開啟", icon: "folderOpen" }];
    // 支援的檔案（Markdown／圖檔／純文字）多一個「在窗格開啟」，說法與資料夾完全一致。
    if (viewerKindOfPath(target.path)) {
      const neighbor = neighborPaneId(paneId);
      const tab = tabs.activeTab;
      items.push({
        id: "open-pane",
        label: neighbor && tab ? `在${paneSlotLabel(tab, neighbor)}窗格開啟` : "在新窗格開啟",
        icon: splitIcon(neighbor && tab ? tab.direction : settings.lastSplit.direction),
        shortcut: "Space",
      });
    }
    if (options.clipboard) {
      append(items, editItems("file", options));
    }
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
  function menuForSelection(request: MenuRequest, options: MenuOptions): MenuItem[] {
    const items: MenuItem[] = [];
    if (options.clipboard) {
      append(items, editItems("multi", options));
    }
    append(items, toolItems(request.targets));
    append(items, transferItems());
    append(items, copyPathItems());
    append(items, [revealItem("在檔案總管中顯示右鍵的項目")]);
    return items;
  }

  function menuFor(request: MenuRequest, options: MenuOptions = {}): MenuItem[] {
    if (!request.targets.length) {
      return menuForBlank(request.target, options);
    }
    if (request.targets.length > 1) {
      return menuForSelection(request, options);
    }
    return request.targets[0].isDir
      ? menuForFolder(request.targets[0], request.paneId, options)
      : menuForFile(request.targets[0], request.paneId, options);
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

  /**
   * 執行選單動作。
   *
   * `options.keepFocus` 只影響 `open-pane` 的資料夾：預設（右鍵選單）會把焦點移到
   * 被打開的窗格；檔案清單的 `Space` 預覽則帶入 `true`，把焦點留在原本的清單，
   * 才能用方向鍵＋`Space` 連續掃描。檔案的 `open-pane` 本來就保留焦點，不受此選項影響。
   */
  async function run(
    id: string,
    request: MenuRequest,
    options: { keepFocus?: boolean } = {},
  ) {
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
      case "rename":
        // 就地編輯由檔案清單自己處理（選到這一項時直接開始編輯，不會走到這裡）。
        return;
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
      case "open-pane": {
        const neighbor = neighborPaneId(request.paneId);
        const keepFocus = options.keepFocus ?? false;
        // 不支援的檔案（例如 .pdf、.mp4）只提示，不先分割出一個空窗格。
        if (!target.isDir && !viewerKindOfPath(target.path)) {
          ui.showNotice("這個檔案類型還沒有檢視器");
          return;
        }
        if (target.isDir && neighbor) {
          // 已經分割了：不新增窗格，直接把資料夾開到相鄰那一邊。
          // 右鍵選單會把焦點一起移過去；`Space` 預覽則留在原本的清單。
          if (!keepFocus) {
            tabs.setActivePane(neighbor);
          }
          await explorer.navigate(neighbor, target.path);
          return;
        }
        if (target.isDir) {
          tabs.split(settings.lastSplit.direction, target.path);
          // `Space` 預覽：分割建立的新窗格會先成為焦點，這裡立刻交還給來源窗格。
          if (keepFocus) {
            tabs.setActivePane(request.paneId);
          }
          return;
        }
        // 檔案：新窗格沿用目前窗格的資料夾（也就是這個檔案所在的資料夾），
        // 再把內容疊上去；關閉檢視器就會回到同一個資料夾的清單。
        //
        // 焦點刻意**留在檔案清單**：這樣可以連續用方向鍵換檔案、按 Space 更新檢視器。
        // 分割建立新窗格時它會先成為焦點，所以這裡立刻把焦點交還給來源窗格。
        if (neighbor) {
          await viewer.open(neighbor, target.path);
          return;
        }
        const source = request.paneId;
        tabs.split(settings.lastSplit.direction, explorer.meta(source)?.currentPath ?? "");
        const created = tabs.activePaneId;
        tabs.setActivePane(source);
        await viewer.open(created, target.path);
        return;
      }
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
