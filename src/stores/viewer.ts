import { defineStore } from "pinia";
import { reactive } from "vue";
import * as api from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { useSettingsStore } from "@/stores/settings";
import type { PaneId } from "@/types/fs";
import type { ViewerMode, ViewerPanelState, ViewerSearchState, ViewerState } from "@/types/viewer";
import { fileNameOf, parentOf, samePath } from "@/utils/path";
import { supportsViewerSearch, viewerKindOfPath } from "@/utils/viewer";
import {
  PANEL_DEFAULT_WIDTH,
  SEARCH_PANEL_DEFAULT_WIDTH,
  type PanelLayout,
} from "@/utils/viewerPanel";

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

/** 搜尋面板的初始狀態：預設關閉、三個選項全關（與其他工具的搜尋一致）。 */
const DEFAULT_SEARCH: ViewerSearchState = {
  open: false,
  query: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

/** 浮動面板的初始值：展開、貼右上角（`x === null`）、給定寬度、高度自適應。 */
function defaultPanel(width: number): ViewerPanelState {
  return { collapsed: false, layout: { x: null, y: 0, width, height: null } };
}

/**
 * 檢視器狀態：綁在窗格上，但與 `explorer` 的瀏覽狀態分開。
 *
 * 一個窗格有檢視器狀態＝顯示檢視器；沒有＝顯示檔案清單。內容讀取、圖片 blob URL
 * 的建立與撤銷、以及「檔案被外部修改就自動重載」的監控都集中在這裡。
 */
export const useViewerStore = defineStore("viewer", () => {
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

  /**
   * 撤銷 PDF 的串流 token；換檔、重新載入與關閉都要走這條。
   *
   * 內容本身不經過這裡（iframe 直接向自訂協定要），所以「釋放」只是讓舊 URL 立刻失效。
   */
  function releaseStream(state: ViewerState) {
    const token = state.streamToken;
    state.streamToken = null;
    state.streamUrl = null;
    if (token) {
      void api.closeFileStream(token).catch(() => undefined);
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
    // 沒有檢視器的類型（kind 為 null）只顯示提示，沒有內容可讀。
    if (!state || state.kind === null) {
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
    // PDF 既不是文字也不是圖片：換一組新的串流 token，交給 iframe 直接讀。
    releaseStream(state);
    if (state.kind === "pdf") {
      await loadStream(paneId, current);
      return;
    }

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

  /**
   * PDF：向後端要一組新的串流 token，把 URL 交給 iframe。
   *
   * 每一輪載入都換一組 token（舊的先撤銷），所以 iframe 的 `src` 一定會變 ——
   * 手動重新整理與外部變更的自動重載都靠這一點，不需要額外的 cache-busting 參數。
   */
  async function loadStream(paneId: PaneId, current: () => boolean): Promise<void> {
    const state = views[paneId];
    if (!state) {
      return;
    }
    try {
      const handle = await api.openFileStream(state.path);
      if (!current() || views[paneId] !== state) {
        // 這一輪已經被換掉了：剛拿到的 token 直接還回去，不要留著。
        if (handle) {
          void api.closeFileStream(handle.token).catch(() => undefined);
        }
        return;
      }
      if (!handle) {
        fail(paneId, "這個預覽模式沒有 PDF 檢視器，請用預設程式開啟");
        return;
      }
      state.streamToken = handle.token;
      state.streamUrl = handle.url;
      state.status = "ready";
      startWatch(paneId, state.path);
    } catch (cause) {
      if (!current() || views[paneId] !== state) {
        return;
      }
      state.status = "error";
      state.error = normalizeBackendError(cause);
    }
  }

  /**
   * 在指定窗格打開檔案；不支援的類型仍然佔用窗格並顯示提示，回傳前不會讀取內容。
   *
   * `sourcePaneId` 是「這份內容是從哪一個檔案清單開的」；圖片的前後切換要用它
   * 才知道順序（見 `composables/useImageNavigation.ts`）。
   */
  async function open(
    paneId: PaneId,
    path: string,
    sourcePaneId: PaneId | null = null,
  ): Promise<void> {
    const kind = viewerKindOfPath(path);
    // 搜尋只在使用者勾選「保留搜尋字串」時帶到新文件；否則整份回到預設（面板關閉）。
    // 浮動面板的收合與位置尺寸一律不沿用 —— 每份文件都從預設值開始。
    const previousSearch = useSettingsStore().viewerSearchKeepQuery
      ? views[paneId]?.search
      : undefined;
    close(paneId);
    views[paneId] = {
      path,
      name: fileNameOf(path) || path,
      sourcePaneId,
      kind,
      // HTML 預設先給使用者看畫面；要讀原始碼再從標頭切換。
      mode: "preview",
      // 沒有檢視器的類型沒有東西可讀，直接是就緒狀態、內容區顯示提示。
      status: kind ? "loading" : "ready",
      error: null,
      text: "",
      encoding: null,
      blobUrl: null,
      streamToken: null,
      streamUrl: null,
      size: 0,
      modifiedMs: null,
      scrollTop: 0,
      search: previousSearch ? { ...previousSearch } : { ...DEFAULT_SEARCH },
      tocPanel: defaultPanel(PANEL_DEFAULT_WIDTH),
      searchPanel: defaultPanel(SEARCH_PANEL_DEFAULT_WIDTH),
    };
    // 沒有檢視器的類型只顯示提示，不去讀檔；它仍然是「目前顯示的目標」，
    // 這樣在檔案清單按 Space 才能繼續往下前進。
    if (kind) {
      await load(paneId);
    }
  }

  /** 切換 HTML 的「預覽／原始碼」；其他種類沒有切換鈕，呼叫也只是改一個沒人讀的欄位。 */
  function setMode(paneId: PaneId, mode: ViewerMode) {
    const state = views[paneId];
    if (state) {
      state.mode = mode;
    }
  }

  /** 標題列的搜尋鈕與 Ctrl+F：文字類檢視器才能開關。 */
  function toggleSearch(paneId: PaneId) {
    const state = views[paneId];
    if (!state || !supportsViewerSearch(state.kind)) {
      return;
    }
    state.search.open = !state.search.open;
  }

  function closeSearch(paneId: PaneId) {
    const state = views[paneId];
    if (state) {
      state.search.open = false;
    }
  }

  /** 搜尋面板的輸入框與三個選項都寫回這裡，換元件時狀態才不會不見。 */
  function updateSearch(paneId: PaneId, patch: Partial<ViewerSearchState>) {
    const state = views[paneId];
    if (state) {
      Object.assign(state.search, patch);
    }
  }

  /** 浮動面板的收合狀態與位置尺寸（拖曳／縮放結束寫回；不持久化）。 */
  function setPanelLayout(paneId: PaneId, which: "toc" | "search", layout: PanelLayout) {
    const state = views[paneId];
    if (state) {
      (which === "toc" ? state.tocPanel : state.searchPanel).layout = { ...layout };
    }
  }

  /** 內容區的捲動位置（元件在捲動與卸載時寫回；切回分頁時還原）。 */
  function setScrollTop(paneId: PaneId, scrollTop: number) {
    const state = views[paneId];
    if (state) {
      state.scrollTop = scrollTop;
    }
  }

  function togglePanelCollapsed(paneId: PaneId, which: "toc" | "search") {
    const state = views[paneId];
    if (state) {
      const panel = which === "toc" ? state.tocPanel : state.searchPanel;
      panel.collapsed = !panel.collapsed;
    }
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
      releaseStream(state);
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

  return {
    views,
    of,
    isOpen,
    open,
    reload,
    setMode,
    toggleSearch,
    closeSearch,
    updateSearch,
    setPanelLayout,
    setScrollTop,
    togglePanelCollapsed,
    retarget,
    close,
    destroy,
  };
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
