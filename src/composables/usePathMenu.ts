import { useExplorerStore } from "@/stores/explorer";
import type { MenuItem } from "@/types/menu";

/**
 * 資料夾／檔案的右鍵選單定義與動作文。
 *
 * 樹狀節點、檔案列、空白處三種場景共用同一份定義，確保「長得一樣就做得一樣」。
 */
export function usePathMenu() {
  const explorer = useExplorerStore();

  const folderMenu: MenuItem[] = [
    { id: "powershell", label: "開啟至 PowerShell", icon: "terminal" },
    { id: "cmd", label: "開啟至命令提示字元", icon: "terminal" },
    { id: "copy-windows", label: "複製路徑（Windows）", icon: "link", separatorBefore: true },
    { id: "copy-linux", label: "複製路徑（Linux）", icon: "link" },
    { id: "reveal", label: "在檔案總管中顯示", icon: "externalLink", separatorBefore: true },
  ];

  const fileMenu: MenuItem[] = [
    { id: "open", label: "開啟", icon: "folderOpen" },
    { id: "notepadpp", label: "開啟至 Notepad++", icon: "text", separatorBefore: true },
    { id: "vscode", label: "開啟至 VS Code", icon: "code" },
    { id: "copy-windows", label: "複製路徑（Windows）", icon: "link", separatorBefore: true },
    { id: "copy-linux", label: "複製路徑（Linux）", icon: "link" },
    { id: "reveal", label: "在檔案總管中顯示", icon: "externalLink", separatorBefore: true },
  ];

  async function run(id: string, path: string) {
    switch (id) {
      case "open":
        await explorer.openPath(path);
        break;
      case "powershell":
        await explorer.runExternal(path, "powershell");
        break;
      case "cmd":
        await explorer.runExternal(path, "cmd");
        break;
      case "notepadpp":
        await explorer.runExternal(path, "notepadpp");
        break;
      case "vscode":
        await explorer.runExternal(path, "vscode");
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
