/**
 * 檢視器資源讀取：把本機檔案讀成可以放進 DOM 的形式。
 *
 * Markdown 的相對圖片與 HTML 靜態預覽共用這一層 —— 兩邊都需要「路徑 → blob URL」
 * 與「路徑 → 文字」，而且都只能經由 `readViewerFile` 這條既有 IPC。
 */

import * as api from "@/services/api";
import type { ViewerStreamEvent } from "@/types/viewer";

/** 指令回應之後，最多再等這麼久讓 Channel 把剩下的訊息送完（以最後一則訊息起算）。 */
const STREAM_IDLE_TIMEOUT_MS = 5000;

/**
 * 讀完整份串流才返回。
 *
 * Tauri 的 `invoke` 回應可能比 Channel 訊息先到 —— 大的訊息（圖片的 base64 分塊）
 * 走另一條非同步通道，指令結束時常常還沒全部送達。只等 `invoke` 就收尾的話，
 * 圖片會被截掉後段（瀏覽器照樣畫出前半張，看起來就是「下面被切掉」）。
 * 所以一定要等到 `done` 事件；串流安靜太久才視為中斷。
 */
async function readWholeStream(
  path: string,
  onEvent: (event: ViewerStreamEvent) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  let done = false;
  let lastEventAt = Date.now();
  let wake: (() => void) | null = null;

  try {
    await api.readViewerFile(
      path,
      (event) => {
        lastEventAt = Date.now();
        if (event.type === "done") {
          done = true;
        } else {
          onEvent(event);
        }
        wake?.();
      },
      signal,
    );
  } catch {
    /*
     * 讀不到就當「這個資源不能用」：檔案不存在、權限不足、或是後端判定為二進位
     * （例如 HTML 引用了 `.mp4`）。呼叫端本來就有「略過這個資源」的處理 ——
     * HTML 預覽會把數量寫進提示條，Markdown 會換成「無法顯示圖片」的佔位文字，
     * 所以不是無聲吞掉。這裡**不能**讓它往上拋：`prepare()` 的 Promise 一旦 reject，
     * 整份 HTML 預覽就永遠停在「正在準備預覽…」。
     */
    return false;
  }

  while (!done && !signal?.aborted && Date.now() - lastEventAt < STREAM_IDLE_TIMEOUT_MS) {
    await new Promise<void>((resolve) => {
      wake = resolve;
      setTimeout(resolve, 50);
    });
    wake = null;
  }
  return done;
}

/** 本機二進位資源讀出來的結果。 */
export interface ViewerResource {
  /** 可直接放進 `img.src`／`link.href` 的 blob URL。 */
  url: string;
  /** 後端判定的 MIME（例如 `image/png`）。 */
  mime: string;
}

/**
 * 讀成 blob URL。
 *
 * 後端只對認得的圖片格式送 base64；其餘（例如被引用到的 `.tif`）會被當成文字讀，
 * 這時回 `null`，呼叫端就知道這個資源不該放進 DOM。
 */
export async function loadViewerBlobUrl(
  path: string,
  signal?: AbortSignal,
): Promise<ViewerResource | null> {
  const chunks: string[] = [];
  let mime: string | null = null;

  const complete = await readWholeStream(
    path,
    (event) => {
      if (event.type === "start") {
        mime = event.mime;
      } else if (event.type === "chunk" && event.base64) {
        chunks.push(event.base64);
      }
    },
    signal,
  );

  if (!complete || !mime || chunks.length === 0) {
    return null;
  }

  const binary = atob(chunks.join(""));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { url: URL.createObjectURL(new Blob([bytes], { type: mime })), mime };
}

/** 讀成文字（外部 CSS 用）；後端把它當圖片讀時回 `null`。 */
export async function loadViewerText(path: string, signal?: AbortSignal): Promise<string | null> {
  const chunks: string[] = [];
  let sawText = false;

  const complete = await readWholeStream(
    path,
    (event) => {
      if (event.type === "chunk" && event.text !== null) {
        sawText = true;
        chunks.push(event.text);
      }
    },
    signal,
  );

  return complete && sawText ? chunks.join("") : null;
}
