/**
 * 檢視器資源讀取：把本機檔案讀成可以放進 DOM 的形式。
 *
 * Markdown 的相對圖片與 HTML 靜態預覽共用這一層 —— 兩邊都需要「路徑 → blob URL」
 * 與「路徑 → 文字」，而且都只能經由 `readViewerFile` 這條既有 IPC。
 */

import * as api from "@/services/api";

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

  await api.readViewerFile(
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

  if (!mime || chunks.length === 0) {
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

  await api.readViewerFile(
    path,
    (event) => {
      if (event.type === "chunk" && event.text !== null) {
        sawText = true;
        chunks.push(event.text);
      }
    },
    signal,
  );

  return sawText ? chunks.join("") : null;
}
