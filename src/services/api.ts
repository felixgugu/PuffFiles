/**
 * 唯一的 IPC 邊界。
 *
 * UI 與 store 一律透過這裡呼叫後端；沒有 Tauri 執行環境時自動降級為 Mock，
 * 讓同一份前端程式碼可以在瀏覽器中開發與測試。
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toBackendError } from "./errors";
import {
  MOCK_DRIVES,
  MOCK_QUICK_LOCATIONS,
  mockClearClipboard,
  mockCreateEntry,
  mockListDirectory,
  mockListSubdirs,
  mockReadClipboard,
  mockWriteClipboard,
} from "./mock";
import type {
  DirStreamEvent,
  DriveInfo,
  FileEntry,
  QuickLocation,
} from "@/types/fs";

export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 串流列舉資料夾；`onEvent` 會被依序呼叫 start → batch* → done。 */
export async function listDirectory(
  path: string,
  onEvent: (event: DirStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!isDesktopRuntime()) {
    await mockListDirectory(path, onEvent, signal);
    return;
  }

  const channel = new Channel<DirStreamEvent>();
  channel.onmessage = (event) => {
    if (!signal?.aborted) {
      onEvent(event);
    }
  };

  try {
    await invoke("list_dir_stream", { path, onEvent: channel });
  } catch (error) {
    throw toBackendError(error);
  }
}

export async function listDrives(): Promise<DriveInfo[]> {
  if (!isDesktopRuntime()) {
    return MOCK_DRIVES;
  }
  return guarded(() => invoke<DriveInfo[]>("list_drives"));
}

/** 只列出子資料夾，供側邊欄樹狀懶載入使用。 */
export async function listSubdirs(path: string): Promise<FileEntry[]> {
  if (!isDesktopRuntime()) {
    return mockListSubdirs(path);
  }
  return guarded(() => invoke<FileEntry[]>("list_subdirs", { path }));
}

export async function quickLocations(): Promise<QuickLocation[]> {
  if (!isDesktopRuntime()) {
    return MOCK_QUICK_LOCATIONS;
  }
  return guarded(() => invoke<QuickLocation[]>("quick_locations"));
}

/** 以系統預設程式開啟。 */
export async function openPath(path: string): Promise<void> {
  if (!isDesktopRuntime()) {
    console.info("[mock] open", path);
    return;
  }
  return guarded(() => invoke("open_path", { path }));
}

/** 在檔案總管中選取該項目。 */
export async function revealPath(path: string): Promise<void> {
  if (!isDesktopRuntime()) {
    console.info("[mock] reveal", path);
    return;
  }
  return guarded(() => invoke("reveal_path", { path }));
}

/** 執行使用者設定的外部工具（引數已在前端依樣板展開）。 */
export async function runExternal(
  program: string,
  args: string[],
  workingDirectory: string | null,
  newConsole: boolean,
): Promise<void> {
  if (!isDesktopRuntime()) {
    console.info("[mock] run external", program, args, workingDirectory, newConsole);
    return;
  }
  return guarded(() =>
    invoke("run_external", { program, args, workingDir: workingDirectory, newConsole }),
  );
}

/** 系統剪貼簿裡的檔案清單（與檔案總管互通）。 */
export interface ClipboardFiles {
  paths: string[];
  cut: boolean;
}

export async function clipboardFiles(): Promise<ClipboardFiles> {
  if (!isDesktopRuntime()) {
    return mockReadClipboard();
  }
  return guarded(() => invoke<ClipboardFiles>("clipboard_files"));
}

export async function setClipboardFiles(paths: string[], cut: boolean): Promise<void> {
  if (!isDesktopRuntime()) {
    mockWriteClipboard(paths, cut);
    return;
  }
  return guarded(() => invoke("set_clipboard_files", { paths, cut }));
}

export async function clearClipboard(): Promise<void> {
  if (!isDesktopRuntime()) {
    mockClearClipboard();
    return;
  }
  return guarded(() => invoke("clear_clipboard"));
}

/** 複製／搬移／刪除都交給 Windows shell；回傳 false 代表使用者取消。 */
export async function copyItems(sources: string[], destination: string): Promise<boolean> {
  if (!isDesktopRuntime()) {
    console.info("[mock] copy", sources, "->", destination);
    return true;
  }
  return guarded(() => invoke<boolean>("copy_items", { sources, destination }));
}

export async function moveItems(sources: string[], destination: string): Promise<boolean> {
  if (!isDesktopRuntime()) {
    console.info("[mock] move", sources, "->", destination);
    return true;
  }
  return guarded(() => invoke<boolean>("move_items", { sources, destination }));
}

export async function deleteItems(paths: string[]): Promise<boolean> {
  if (!isDesktopRuntime()) {
    console.info("[mock] delete", paths);
    return true;
  }
  return guarded(() => invoke<boolean>("delete_items", { paths }));
}

/** 建立資料夾；成功時回傳新資料夾的完整路徑。 */
export async function createFolder(parent: string, name: string): Promise<string> {
  if (!isDesktopRuntime()) {
    return mockCreateEntry(parent, name, true);
  }
  return guarded(() => invoke<string>("create_folder", { parent, name }));
}

/** 建立空檔案；成功時回傳新檔案的完整路徑。 */
export async function createFile(parent: string, name: string): Promise<string> {
  if (!isDesktopRuntime()) {
    return mockCreateEntry(parent, name, false);
  }
  return guarded(() => invoke<string>("create_file", { parent, name }));
}

/** 檔案操作紀錄的最後幾行（本機日誌檔）。 */
export async function operationLog(lines = 200): Promise<string> {
  if (!isDesktopRuntime()) {
    return "[mock] 瀏覽器預覽模式沒有紀錄檔";
  }
  return guarded(() => invoke<string>("operation_log", { lines }));
}

export async function operationLogPath(): Promise<string> {
  if (!isDesktopRuntime()) {
    return "";
  }
  return guarded(() => invoke<string>("operation_log_path"));
}

export type WatchKind = "added" | "removed" | "modified" | "rescan";

export interface WatchEvent {
  kind: WatchKind;
  path: string;
  /** 新增與內容變更會附帶完整項目；移除與重掃為 null。 */
  entry: FileEntry | null;
}

/** 開始監控資料夾；變更會透過回呼送進來。瀏覽器預覽模式沒有監控。 */
export async function watchDirectory(
  id: string,
  path: string,
  onEvent: (event: WatchEvent) => void,
): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }
  const channel = new Channel<WatchEvent>();
  channel.onmessage = (event) => onEvent(event);
  return guarded(() => invoke("watch_dir", { id, path, onEvent: channel }));
}

export async function unwatchDirectory(id: string): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }
  return guarded(() => invoke("unwatch_dir", { id }));
}

/** 原生資料夾選擇器；瀏覽器開發模式下沒有原生對話框，回傳 null。 */
export async function chooseFolder(defaultPath?: string): Promise<string | null> {
  if (!isDesktopRuntime()) {
    console.info("[mock] choose folder", defaultPath);
    return null;
  }
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "選擇資料夾",
      defaultPath: defaultPath || undefined,
    });
    return typeof selected === "string" ? selected : null;
  } catch (error) {
    throw toBackendError(error);
  }
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toBackendError(error);
  }
}
