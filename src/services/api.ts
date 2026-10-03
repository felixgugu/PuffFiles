/**
 * 唯一的 IPC 邊界。
 *
 * UI 與 store 一律透過這裡呼叫後端；沒有 Tauri 執行環境時自動降級為 Mock，
 * 讓同一份前端程式碼可以在瀏覽器中開發與測試。
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toBackendError } from "./errors";
import { MOCK_DRIVES, MOCK_QUICK_LOCATIONS, mockListDirectory, mockListSubdirs } from "./mock";
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
