import { computed } from "vue";
import * as api from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { useExplorerStore } from "@/stores/explorer";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import type { MenuItem } from "@/types/menu";
import type { ExternalTool, ToolVars } from "@/types/tools";
import { fileNameOf, parentOf } from "@/utils/path";
import { applyVars, buildVars } from "@/utils/toolVars";

/** 右鍵選單的對象：檔案或資料夾，以及它自己的完整路徑。 */
export interface MenuTarget {
  path: string;
  isDir: boolean;
}

/**
 * 右鍵選單的內容與動作。
 *
 * 外部工具完全來自使用者的設定清單，依「檔案／資料夾」篩選；
 * 引數與工作目錄在執行前才把變數展開成實際路徑。
 */
export function usePathMenu() {
  const explorer = useExplorerStore();
  const settings = useSettingsStore();
  const tabs = useTabsStore();
  const ui = useUiStore();

  function toVars(target: MenuTarget | null): ToolVars | null {
    if (!target?.path) {
      return null;
    }
    const fullFolderPath = target.isDir
      ? target.path
      : (parentOf(target.path) ?? target.path);
    return {
      fullFilePath: target.path,
      fullFolderPath,
      fileName: fileNameOf(target.path),
      folderName: fileNameOf(fullFolderPath) || fullFolderPath,
    };
  }

  /** 目標（無後綴）＋ 左／上窗格（1）＋ 右／下窗格（2）。 */
  function varsFor(target: MenuTarget | null): Record<string, string> {
    const paneIds = tabs.activeTab?.paneIds ?? [];
    const paneVars = paneIds.map((id) => toVars(explorer.selectionTarget(id)));
    return buildVars(toVars(target), paneVars);
  }

  function toolItems(kind: "file" | "folder"): MenuItem[] {
    return settings.tools
      .filter((tool) => tool.targets.includes(kind))
      .map((tool) => ({ id: `tool:${tool.id}`, label: tool.label, icon: tool.icon }));
  }

  function copyItems(): MenuItem[] {
    return [
      { id: "copy-windows", label: "複製路徑（Windows）", icon: "link" },
      { id: "copy-linux", label: "複製路徑（Linux）", icon: "link" },
    ];
  }

  const folderMenu = computed<MenuItem[]>(() => {
    const items = toolItems("folder");
    const copy = copyItems();
    items.push({ ...copy[0], separatorBefore: items.length > 0 });
    items.push(copy[1]);
    items.push({ id: "reveal", label: "在檔案總管中顯示", icon: "externalLink", separatorBefore: true });
    return items;
  });

  const fileMenu = computed<MenuItem[]>(() => {
    const items: MenuItem[] = [{ id: "open", label: "開啟", icon: "folderOpen" }];
    const tools = toolItems("file");
    tools.forEach((tool, index) => items.push({ ...tool, separatorBefore: index === 0 }));
    const copy = copyItems();
    items.push({ ...copy[0], separatorBefore: true });
    items.push(copy[1]);
    items.push({ id: "reveal", label: "在檔案總管中顯示", icon: "externalLink", separatorBefore: true });
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

  async function run(id: string, target: MenuTarget | null) {
    if (id.startsWith("tool:")) {
      const tool = settings.tools.find((item) => item.id === id.slice(5));
      if (tool) {
        await runTool(tool, target);
      }
      return;
    }

    const path = target?.path;
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
