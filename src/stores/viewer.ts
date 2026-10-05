import { defineStore } from "pinia";
import { reactive } from "vue";
import * as api from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { useUiStore } from "@/stores/ui";
import type { PaneId } from "@/types/fs";
import type { ViewerState } from "@/types/viewer";
import { fileNameOf, parentOf, samePath } from "@/utils/path";
import { viewerKindOfPath } from "@/utils/viewer";

/** 監控事件進來後等這麼久才重載：編輯器存檔常常一次送出好幾筆通知。 */
const RELOAD_DEBOUNCE_MS = 250;
/** 監控用的 id 前綴，與窗格自己的目錄監控完全隔開。 */
const WATCH_PREFIX = "viewer:";
/**
 * 串流收尾的等待時間。
 *
 * Tauri 的 `invoke` 回應與 Channel 訊息走不同的路徑，**不保證順序**：
 * 第一次開啟（同一時間窗格還在串流目錄清單）時，回應常常比 chunk 先到。
 * 收到回應後先等串流安靜下來再收尾，才不會把「還在路上」誤判成「讀不到內容」。
 */
const STREAM_QUIET_MS = 120;
const STREAM_SETTLE_MAX_MS = 3000;

/**
 * 檢視器狀態：綁在窗格上，但與 `explorer` 的瀏覽狀態分開。
 *
 * 一個窗格有檢視器狀態＝顯示檢視器；沒有＝顯示檔案清單。內容讀取、圖片 blob URL
 * 的建立與撤銷、以及「檔案被外部修改就自動重載」的監控都集中在這裡。
 */
export const useViewerStore = defineStore("viewer", () => {
  const ui = useUiStore();
  const views = reactive<Record<PaneId, ViewerState>>({});

  const controllers = new Map<PaneId, AbortController>();
  const watchedFiles = new Map<PaneId, string>();
  const reloadTimers = new Map<PaneId, ReturnType<typeof setTimeout>>();
  const versions = new Map<PaneId, number>();

  function of(paneId: PaneId): ViewerState | null {
    return views[paneId] ?? null;
  }

  function isOpen(paneId: PaneId): boolean {
    return views[paneId] !== undefined;
  }

  function stopWatch(paneId: PaneId) {
    if (!watchedFiles.delete(paneId)) {
      return;
    }
    void api.unwatchDirectory(`${WATCH_PREFIX}${paneId}`).catch(() => undefined);
  }

  function clearTimer(paneId: PaneId) {
    const timer = reloadTimers.get(paneId);
    if (timer) {
      clearTimeout(timer);
      reloadTimers.delete(paneId);
    }
  }

  /** 監控檔案所在的資料夾，只對這個檔案的反應（變更、刪除、重建）。 */
  function startWatch(paneId: PaneId, filePath: string) {
    stopWatch(paneId);
    const directory = parentOf(filePath);
    if (!directory) {
      return;
    }
    watchedFiles.set(paneId, filePath);
    void api
      .watchDirectory(`${WATCH_PREFIX}${paneId}`, directory, (event) => {
        if (!samePath(event.path, watchedFiles.get(paneId) ?? "")) {
          return;
        }
        clearTimer(paneId);
        reloadTimers.set(
          paneId,
          setTimeout(() => {
            reloadTimers.delete(paneId);
            void load(paneId);
          }, RELOAD_DEBOUNCE_MS),
        );
      })
      .catch(() => {
        // 有些位置不支援監控；放棄自動重載，手動重新整理仍然可用。
        watchedFiles.delete(paneId);
      });
  }

  function releaseBlob(state: ViewerState) {
    if (state.blobUrl) {
      URL.revokeObjectURL(state.blobUrl);
      state.blobUrl = null;
    }
  }

  function finish(paneId: PaneId, chunks: string[], mime: string | null) {
    const state = views[paneId];
    if (!state || state.status !== "loading") {
      return;
    }

    if (state.kind === "image") {
      try {
        const bytes = base64ToBytes(chunks);
        state.blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime ?? "application/octet-stream" }));
      } catch {
        fail(paneId, "圖片內容解碼失敗");
        return;
      }
    } else {
      state.text = chunks.join("");
    }

    state.status = "ready";
    startWatch(paneId, state.path);
  }

  function fail(paneId: PaneId, message: string) {
    const state = views[paneId];
    if (!state) {
      return;
    }
    state.status = "error";
    state.error = normalizeBackendError(new Error(message));
  }

  async function load(paneId: PaneId, attempt = 0): Promise<void> {
    const state = views[paneId];
    if (!state) {
      return;
    }

    clearTimer(paneId);
    controllers.get(paneId)?.abort();
    const controller = new AbortController();
    controllers.set(paneId, controller);

    const version = (versions.get(paneId) ?? 0) + 1;
    versions.set(paneId, version);
    const current = () => versions.get(paneId) === version && !controller.signal.aborted;

    state.status = "loading";
    state.error = null;
    state.text = "";
    state.encoding = null;
    releaseBlob(state);

    const chunks: string[] = [];
    let mime: string | null = null;
    let started = false;
    let lastEventAt = Date.now();

    try {
      await api.readViewerFile(
        state.path,
        (event) => {
          if (!current()) {
            return;
          }
          lastEventAt = Date.now();
          switch (event.type) {
            case "start":
              started = true;
              state.name = event.name || state.name;
              state.size = event.size;
              state.modifiedMs = event.modifiedMs;
              state.encoding = event.encoding;
              mime = event.mime;
              break;
            case "chunk":
              chunks.push(event.text ?? event.base64 ?? "");
              break;
            case "done":
              finish(paneId, chunks, mime);
              break;
          }
        },
        controller.signal,
      );

      // 回應可能比 Channel 訊息先到：等到串流安靜下來（或逾時）再收尾。
      const waitingSince = Date.now();
      while (
        current() &&
        state.status === "loading" &&
        Date.now() - lastEventAt < STREAM_QUIET_MS &&
        Date.now() - waitingSince < STREAM_SETTLE_MAX_MS
      ) {
        await delay(25);
      }

      if (!current() || state.status !== "loading") {
        return;
      }

      // 檔案有內容卻連一個位元組都沒收到：先自動重試一次，真的不行才報錯。
      if (chunks.length === 0 && (!started || state.size > 0)) {
        if (attempt === 0) {
          await load(paneId, 1);
          return;
        }
        fail(paneId, "讀不到檔案內容，請按重試或關閉檢視器");
        return;
      }

      finish(paneId, chunks, mime);
    } catch (cause) {
      if (!current()) {
        return;
      }
      state.status = "error";
      state.error = normalizeBackendError(cause);
    }
  }

  /** 在指定窗格打開檔案；不支援的類型只提示，不會佔用窗格。 */
  async function open(paneId: PaneId, path: string): Promise<void> {
    const kind = viewerKindOfPath(path);
    if (!kind) {
      ui.showNotice("這個檔案類型還沒有檢視器");
      return;
    }

    close(paneId);
    views[paneId] = {
      path,
      name: fileNameOf(path) || path,
      kind,
      status: "loading",
      error: null,
      text: "",
      encoding: null,
      blobUrl: null,
      size: 0,
      modifiedMs: null,
    };
    await load(paneId);
  }

  function reload(paneId: PaneId): Promise<void> {
    return load(paneId);
  }

  function close(paneId: PaneId) {
    clearTimer(paneId);
    stopWatch(paneId);
    controllers.get(paneId)?.abort();
    controllers.delete(paneId);
    versions.delete(paneId);

    const state = views[paneId];
    if (state) {
      releaseBlob(state);
      delete views[paneId];
    }
  }

  /** 窗格被銷毀時走這條；與 close 的差別只有語意。 */
  function destroy(paneId: PaneId) {
    close(paneId);
  }

  /**
   * 檔案被重新命名時，把還開著舊路徑的檢視器改指向新路徑並重載。
   *
   * 檢視器的自動重載只認原本的路徑；不改指向的話，改名後畫面會停在「檔案已不存在」
   * 的錯誤狀態（因為監控看到舊檔名被移除）。
   */
  async function retarget(oldPath: string, newPath: string): Promise<void> {
    const affected = Object.keys(views).filter((paneId) => samePath(views[paneId].path, oldPath));
    await Promise.all(
      affected.map(async (paneId) => {
        const state = views[paneId];
        stopWatch(paneId);
        state.path = newPath;
        state.name = fileNameOf(newPath) || newPath;
        await load(paneId);
      }),
    );
  }

  return { views, of, isOpen, open, reload, retarget, close, destroy };
});

function base64ToBytes(chunks: string[]): Uint8Array<ArrayBuffer> {
  const binary = atob(chunks.join(""));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// setup store 內有非響應式快取（blob URL、監控、AbortController），
// 熱更新無法安全接手；整頁重載才能保證狀態一致。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
