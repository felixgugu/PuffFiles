/**
 * 視窗控制（自繪標題列用）。
 *
 * 瀏覽器開發模式下 `getCurrentWindow()` 會直接爆掉，因此一律先檢查執行環境；
 * 這個模組是 UI 唯一允許碰 `@tauri-apps/api/window` 的地方。
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktopRuntime } from "./api";

function appWindow() {
  return isDesktopRuntime() ? getCurrentWindow() : null;
}

export async function minimizeWindow(): Promise<void> {
  await appWindow()?.minimize();
}

export async function toggleMaximizeWindow(): Promise<void> {
  await appWindow()?.toggleMaximize();
}

export async function closeWindow(): Promise<void> {
  await appWindow()?.close();
}

export async function isWindowMaximized(): Promise<boolean> {
  return (await appWindow()?.isMaximized()) ?? false;
}

/** 監聽視窗尺寸變化並回報目前是否最大化；回傳取消訂閱函式。 */
export function watchMaximized(onChange: (maximized: boolean) => void): () => void {
  const win = appWindow();
  if (!win) {
    return () => {};
  }

  let disposed = false;
  let pendingUnlisten: (() => void) | undefined;

  const sync = () => {
    void win.isMaximized().then((maximized) => {
      if (!disposed) {
        onChange(maximized);
      }
    });
  };

  void win.onResized(sync).then((unlisten) => {
    if (disposed) {
      unlisten();
      return;
    }
    pendingUnlisten = unlisten;
  });

  sync();

  return () => {
    disposed = true;
    pendingUnlisten?.();
  };
}
