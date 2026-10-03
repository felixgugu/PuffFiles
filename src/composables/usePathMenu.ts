import { computed } from "vue";
import * as api from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { useClipboardStore } from "@/stores/clipboard";
import { useExplorerStore } from "@/stores/explorer";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import type { MenuItem } from "@/types/menu";
import type { ExternalTool, ToolVars } from "@/types/tools";
import { fileNameOf, fileStemOf, normalizeKey, parentOf } from "@/utils/path";
import { applyVars, buildVars } from "@/utils/toolVars";

/** 右鍵選單的對象：檔案或資料夾，以及它自己的完整路徑。 */
export interface MenuTarget {
  path: string;
  isDir: boolean;
}

/**
 * 右鍵選單的內容與動作。
 *
 * 檔案操作一律交給 Windows shell；外部工具則完全來自使用者的設定清單，
 * 依「檔案／資料夾」篩選，引數在執行前才把變數展開成實際路徑。
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

  /**
   * 檔案操作作用的對象：右鍵的那個項目若已在選取範圍內，就作用於整個選取；
   * 否則只作用於它自己（與檔案總管一致）。
   */
  function targetsFor(target: MenuTarget | null): string[] {
    const selection = clipboard.selectionOf(tabs.activePaneId);
    if (!target?.path) {
      return selection;
    }
    const key = normalizeKey(target.path);
    return selection.some((path) => normalizeKey(path) === key) ? selection : [target.path];
  }

  function toolItems(kind: "file" | "folder"): MenuItem[] {
    return settings.tools
      .filter((tool) => tool.targets.includes(kind))
      .map((tool) => ({ id: `tool:${tool.id}`, label: tool.label, icon: tool.icon }));
  }

  /** 檔案總管的習慣：新增只出現在資料夾的右鍵選單（含空白處）。 */
  function newItems(): MenuItem[] {
    return [
      { id: "new-folder", label: "建立新資料夾", icon: "folder", shortcut: "Ctrl+Shift+N" },
      { id: "new-file", label: "建立新檔案", icon: "file" },
    ];
  }

  function clipboardItems(kind: "file" | "folder"): MenuItem[] {
    const items: MenuItem[] = [
      { id: "cut", label: "剪下", icon: "scissors", shortcut: "Ctrl+X" },
      { id: "copy", label: "複製", icon: "copy", shortcut: "Ctrl+C" },
    ];
    if (kind === "folder") {
      items.push({ id: "paste", label: "貼上", icon: "paste", shortcut: "Ctrl+V" });
    }
    items.push({ id: "delete", label: "刪除", icon: "trash", shortcut: "Del" });
    return items;
  }

  /** 只有分割時才提供的「送到另一邊」。 */
  function transferItems(): MenuItem[] {
    const tab = tabs.activeTab;
    if (!tab || !tabs.otherPaneId(tab)) {
      return [];
    }
    return [
      { id: "transfer-copy", label: "複製到另一窗格", icon: "copy", shortcut: "Ctrl+Shift+C" },
      { id: "transfer-move", label: "移動到另一窗格", icon: "move", shortcut: "Ctrl+Shift+M" },
    ];
  }

  function copyPathItems(): MenuItem[] {
    return [
      { id: "copy-windows", label: "複製路徑（Windows）", icon: "link" },
      { id: "copy-linux", label: "複製路徑（Linux）", icon: "link" },
    ];
  }

  function appendWithSeparator(items: MenuItem[], block: MenuItem[]) {
    block.forEach((item, index) => {
      items.push({ ...item, separatorBefore: index === 0 ? items.length > 0 : false });
    });
  }

  const folderMenu = computed<MenuItem[]>(() => {
    const items: MenuItem[] = [];
    appendWithSeparator(items, newItems());
    appendWithSeparator(items, clipboardItems("folder"));
    appendWithSeparator(items, toolItems("folder"));
    appendWithSeparator(items, transferItems());
    appendWithSeparator(items, copyPathItems());
    items.push({
      id: "reveal",
      label: "在檔案總管中顯示",
      icon: "externalLink",
      separatorBefore: true,
    });
    return items;
  });

  const fileMenu = computed<MenuItem[]>(() => {
    const items: MenuItem[] = [{ id: "open", label: "開啟", icon: "folderOpen" }];
    appendWithSeparator(items, clipboardItems("file"));
    appendWithSeparator(items, toolItems("file"));
    appendWithSeparator(items, transferItems());
    appendWithSeparator(items, copyPathItems());
    items.push({
      id: "reveal",
      label: "在檔案總管中顯示",
      icon: "externalLink",
      separatorBefore: true,
    });
    return items;
  });

  async function runTool(tool: ExternalTool, target: MenuTarget | null) {
    const vars = varsFor(target);
    const program = applyVars(tool.executable, vars).trim();
    if (!program) {
      ui.showNotice(`「${tool.label}」還沒有設定執行檔`);
      return;
    }

    const args = tool.args
      .map((arg) => applyVars(arg, vars))
      // 變數取不到值時會展開成空字串，這種引數直接丟掉，不要送空引數給程式。
      .filter((arg) => arg.trim() !== "");
    const workingDirectory = applyVars(tool.workingDirectory, vars).trim();

    try {
      await api.runExternal(program, args, workingDirectory || null, tool.newConsole);
    } catch (cause) {
      ui.showNotice(normalizeBackendError(cause).message, undefined, 4200);
    }
  }

  /** 建立新項目：先問名稱，再交給後端；檔名預設只選取主檔名。 */
  async function createEntry(kind: "folder" | "file", target: MenuTarget | null) {
    const folder = target?.isDir
      ? target.path
      : target
        ? (parentOf(target.path) ?? "")
        : explorer.meta(tabs.activePaneId)?.currentPath ?? "";
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

  async function run(id: string, target: MenuTarget | null) {
    const paneId = tabs.activePaneId;

    if (id.startsWith("tool:")) {
      const tool = settings.tools.find((item) => item.id === id.slice(5));
      if (tool) {
        await runTool(tool, target);
      }
      return;
    }

    const path = target?.path;
    switch (id) {
      case "new-folder":
        await createEntry("folder", target);
        return;
      case "new-file":
        await createEntry("file", target);
        return;
      case "cut":
        await clipboard.put(targetsFor(target), true);
        return;
      case "copy":
        await clipboard.put(targetsFor(target), false);
        return;
      case "paste":
        await clipboard.paste(paneId, target?.isDir ? target.path : undefined);
        return;
      case "delete":
        await clipboard.removePaths(targetsFor(target));
        return;
      case "transfer-copy":
        await clipboard.transferToOtherPane("copy");
        return;
      case "transfer-move":
        await clipboard.transferToOtherPane("move");
        return;
      default:
        break;
    }

    if (!path) {
      return;
    }
    switch (id) {
      case "open":
        await explorer.openPath(path);
        break;
      case "copy-windows":
        await explorer.copyPath(path, "windows");
        break;
      case "copy-linux":
        await explorer.copyPath(path, "linux");
        break;
      case "reveal":
        await explorer.revealTarget(path);
        break;
      default:
        break;
    }
  }

  return { folderMenu, fileMenu, run };
}
