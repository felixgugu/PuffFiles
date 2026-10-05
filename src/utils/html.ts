/**
 * HTML 靜態預覽用的純函數。
 *
 * 這裡只做「字串進、字串出」的處理（`DOMParser` 純粹當解析器用，不碰 IPC、
 * 也不碰 Vue 狀態）；讀檔與 blob URL 在 `services/viewerResource.ts`，
 * 編排順序在 `components/viewer/HtmlView.vue`。
 */

/** 沒有檢視器、只能拿掉來源的元素。 */
const UNSUPPORTED_MEDIA_SELECTOR = "iframe, embed, object, video, audio, track";
const MEDIA_SOURCE_ATTRIBUTES = ["src", "data", "poster", "srcset"];

/**
 * 本機資源改寫前的暫存屬性。
 *
 * 來源屬性會在清洗階段被搬進來，`iframe` 拿到的文件因此不含任何可載入的
 * 相對路徑（也就不會對 App 自己的 origin 發出 404），真正內容由父層進
 * `contentDocument` 讀檔後補上。
 */
export const DEFERRED_SRC_ATTRIBUTE = "data-pufffile-src";
export const DEFERRED_SRCSET_ATTRIBUTE = "data-pufffile-srcset";
export const DEFERRED_HREF_ATTRIBUTE = "data-pufffile-href";

/** 讀不到的圖片換成的佔位文字。 */
export const IMAGE_PLACEHOLDER_CLASS = "pufffile-image-missing";

/**
 * 佔位符的樣式，插在文件的 `<head>` 最後。
 *
 * 預覽是獨立的文件，拿不到 App 的設計權杖，所以顏色寫死成中性灰 ——
 * 深淺色底的頁面都看得清楚。
 */
const PLACEHOLDER_STYLE = `.${IMAGE_PLACEHOLDER_CLASS}{display:inline-block;vertical-align:middle;border:1px dashed #9ca3af;border-radius:6px;padding:.25em .6em;color:#6b7280;font-size:.9em;line-height:1.5}`;

export interface SanitizedHtml {
  /** 可以直接放進 `iframe[srcdoc]` 的完整文件。 */
  html: string;
  /** 原始碼裡有 `<script>`；預覽不會執行它，用來顯示提示條。 */
  hasScript: boolean;
  /** 清洗階段就拿掉的資源數量（遠端資源、外部 link、影格、影音…）。 */
  skipped: number;
}

/**
 * 把原始 HTML 洗成「沒有行為、只留靜態內容」的文件。
 *
 * 移除 `<script>`、`<base>`、`<meta>`、`on*` 事件屬性，以及所有非樣式表的
 * `<link>`；`<iframe>`／`<video>` 這類元素拿掉來源屬性（元素本身留著，標籤還在）。
 * 遠端資源一律拿掉，本機資源搬到 `data-pufffile-*` 等父層接手 —— 兩者都必須在
 * 文件進到 `iframe` 之前完成，否則遠端資源會在解析時就被瀏覽器抓下來。
 * `sandbox` 已經保證不執行腳本，這裡是第二層：讓 DOM 本身就是靜態的。
 */
export function sanitizeHtml(source: string): SanitizedHtml {
  const doc = new DOMParser().parseFromString(source, "text/html");
  const hasScript = doc.querySelector("script") !== null;
  let skipped = 0;

  doc.querySelectorAll("script, base").forEach((node) => node.remove());

  // charset／http-equiv 是給位元組解析用的；文件的編碼早就由後端處理完了，
  // 留著反而可能讓瀏覽器用錯編碼讀我們已經解碼好的字串。
  doc.querySelectorAll("meta").forEach((meta) => {
    const httpEquiv = (meta.getAttribute("http-equiv") ?? "").toLowerCase();
    if (meta.hasAttribute("charset") || httpEquiv === "content-type" || httpEquiv === "refresh") {
      meta.remove();
    }
  });

  doc.querySelectorAll("link").forEach((link) => {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase();
    if (rel !== "stylesheet" || !link.hasAttribute("href")) {
      link.remove();
      skipped++;
    }
  });

  doc.querySelectorAll(UNSUPPORTED_MEDIA_SELECTOR).forEach((element) => {
    let removed = false;
    for (const attribute of MEDIA_SOURCE_ATTRIBUTES) {
      if (element.hasAttribute(attribute)) {
        element.removeAttribute(attribute);
        removed = true;
      }
    }
    if (removed) {
      skipped++;
    }
  });

  for (const element of doc.querySelectorAll("img[src], source[src], input[src]")) {
    const kind = deferReference(element, "src", DEFERRED_SRC_ATTRIBUTE);
    if (kind === "remote") {
      skipped++;
      replaceMissingImage(element);
    } else if (kind === "anchor") {
      // `src=""` 等於指向文件自己，同樣是破圖；換成佔位文字但不重複計數。
      replaceMissingImage(element);
    }
  }

  for (const element of doc.querySelectorAll("[srcset]")) {
    deferSrcset(element);
  }

  // 行內 SVG 的 <image>：`href` 與舊的 `xlink:href` 都可能連外。
  doc.querySelectorAll("image").forEach((element) => {
    const reference = element.getAttribute("href") ?? element.getAttribute("xlink:href") ?? "";
    element.removeAttribute("href");
    element.removeAttribute("xlink:href");
    const kind = referenceKind(reference);
    if (kind === "local") {
      element.setAttribute(DEFERRED_HREF_ATTRIBUTE, reference);
    } else if (kind === "inline") {
      element.setAttribute("href", reference);
    } else if (kind === "remote") {
      skipped++;
    }
  });

  doc.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "background") {
        element.removeAttribute(attribute.name);
      }
    }
  });

  if (doc.querySelector(`.${IMAGE_PLACEHOLDER_CLASS}`)) {
    ensurePlaceholderStyle(doc);
  }

  return { html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, hasScript, skipped };
}

/**
 * 把讀不到的 `<img>` 換成看得懂的佔位文字。
 *
 * `alt` 是空字串代表這張圖是裝飾性的，直接移除；只有 `<img>` 會被換掉，
 * `<source>` 這類不直接佔版面的元素單純拿掉來源就好。
 */
export function replaceMissingImage(element: Element): void {
  if (element.tagName.toLowerCase() !== "img") {
    element.remove();
    return;
  }

  const label = missingImageLabel(element);
  const doc = element.ownerDocument;
  if (!label) {
    element.remove();
    return;
  }

  const placeholder = doc.createElement("span");
  placeholder.className = IMAGE_PLACEHOLDER_CLASS;
  placeholder.textContent = label;
  element.replaceWith(placeholder);
  ensurePlaceholderStyle(doc);
}

/** 佔位文字：有 `alt` 就帶著它，沒有 `alt` 屬性就給一句通用說明，空 `alt` 回 `null`。 */
function missingImageLabel(element: Element): string | null {
  if (!element.hasAttribute("alt")) {
    return "無法顯示圖片";
  }
  const alt = (element.getAttribute("alt") ?? "").trim();
  return alt ? `無法顯示圖片：${alt}` : null;
}

function ensurePlaceholderStyle(doc: Document): void {
  if (doc.querySelector("style[data-pufffile-placeholder]")) {
    return;
  }
  const style = doc.createElement("style");
  style.setAttribute("data-pufffile-placeholder", "");
  style.textContent = PLACEHOLDER_STYLE;
  doc.head?.append(style);
}

/**
 * 依來源種類決定 `src`／`href` 的去向：`inline` 原樣保留、`local` 搬到 `storeAs`、
 * 其餘（遠端與空的）一律拿掉。回傳原本的種類，呼叫端才知道要不要計數。
 */
function deferReference(element: Element, attribute: string, storeAs: string): ReferenceKind {
  const reference = element.getAttribute(attribute) ?? "";
  const kind = referenceKind(reference);
  element.removeAttribute(attribute);
  if (kind === "inline") {
    element.setAttribute(attribute, reference);
  } else if (kind === "local") {
    element.setAttribute(storeAs, reference);
  }
  return kind;
}

/**
 * `srcset` 只在「全部都是 data:」時原樣保留；只要混到本機或遠端，就整串搬到
 * `data-pufffile-srcset`，由父層逐個候選重新組回（遠端候選到那裡才算未載入）。
 */
function deferSrcset(element: Element): void {
  const value = element.getAttribute("srcset") ?? "";
  const candidates = splitSrcset(value);
  if (
    candidates.length === 0 ||
    candidates.every((candidate) => referenceKind(candidate.reference) === "inline")
  ) {
    return;
  }
  element.removeAttribute("srcset");
  element.setAttribute(DEFERRED_SRCSET_ATTRIBUTE, value);
}

export type ReferenceKind = "local" | "inline" | "remote" | "anchor";

/**
 * 分類一個 `src`／`href` 的值。
 *
 * - `local`：相對於目前檔案的本機路徑，或 `file://` 與磁碟絕對路徑。
 * - `inline`：`data:`／`blob:`，原樣保留。
 * - `remote`：http(s)、protocol-relative 或任何其他 scheme，預覽一律不載入。
 * - `anchor`：空字串或 `#` 開頭，不需要載入任何東西。
 */
export function referenceKind(reference: string): ReferenceKind {
  const value = reference.trim();
  if (!value || value.startsWith("#")) {
    return "anchor";
  }
  if (value.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(value) || /^file:\/\//i.test(value)) {
    return "local";
  }
  if (/^(data|blob):/i.test(value)) {
    return "inline";
  }
  if (value.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    return "remote";
  }
  return "local";
}

/** 拆出參考值尾端的 `?query`／`#fragment`，改寫後要接回 blob URL。 */
export function splitReference(reference: string): { target: string; suffix: string } {
  const index = reference.search(/[?#]/);
  return index === -1
    ? { target: reference, suffix: "" }
    : { target: reference.slice(0, index), suffix: reference.slice(index) };
}

/** 找出 CSS 裡所有需要解析的位址（`url(...)` 與 `@import "..."`），去重後回傳。 */
export function collectCssReferences(css: string): string[] {
  const found = new Set<string>();
  const urlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)/gi;
  const importPattern = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;

  for (const match of css.matchAll(urlPattern)) {
    found.add((match[1] ?? match[2] ?? match[3] ?? "").trim());
  }
  for (const match of css.matchAll(importPattern)) {
    found.add((match[1] ?? match[2] ?? "").trim());
  }

  found.delete("");
  return [...found];
}

/**
 * 依 `resolve` 給的結果改寫 CSS 位址。
 *
 * `resolve` 回 `null` 代表這個位址不載入：`url(...)` 換成 `none`（等同沒有背景），
 * `@import` 換成註解 —— 兩者都不會讓瀏覽器去連原本的位址。
 */
export function rewriteCssReferences(
  css: string,
  resolve: (reference: string) => string | null,
): string {
  const withUrls = css.replace(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)/gi,
    (match, doubleQuoted, singleQuoted, bare) => {
      const reference = String(doubleQuoted ?? singleQuoted ?? bare ?? "").trim();
      if (!reference) {
        return match;
      }
      const url = resolve(reference);
      return url ? `url("${escapeUrl(url)}")` : "none";
    },
  );

  return withUrls.replace(
    /@import\s+(?:"([^"]*)"|'([^']*)')/gi,
    (_match, doubleQuoted, singleQuoted) => {
      const reference = String(doubleQuoted ?? singleQuoted ?? "").trim();
      const url = reference ? resolve(reference) : null;
      return url ? `@import url("${escapeUrl(url)}")` : "/* pufffile: @import 未載入 */";
    },
  );
}

export interface SrcsetCandidate {
  reference: string;
  descriptor: string;
}

/** 拆 `srcset`（逗號分隔、可帶 `1x`／`640w` 描述子）；data URI 裡的逗號不算分隔。 */
export function splitSrcset(value: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  let index = 0;

  while (index < value.length) {
    while (index < value.length && (value[index] === "," || /\s/.test(value[index]))) {
      index++;
    }
    if (index >= value.length) {
      break;
    }

    const dataUri = value.startsWith("data:", index);
    const start = index;
    while (index < value.length && !/\s/.test(value[index]) && (dataUri || value[index] !== ",")) {
      index++;
    }
    const reference = value.slice(start, index);

    const descriptorStart = index;
    while (index < value.length && value[index] !== ",") {
      index++;
    }
    const descriptor = value.slice(descriptorStart, index).trim();

    if (reference) {
      candidates.push({ reference, descriptor });
    }
  }

  return candidates;
}

export function joinSrcset(candidates: readonly SrcsetCandidate[]): string {
  return candidates
    .map((candidate) =>
      candidate.descriptor ? `${candidate.reference} ${candidate.descriptor}` : candidate.reference,
    )
    .join(", ");
}

/** blob URL 不會含引號或換行，這裡只是防禦性清掉。 */
function escapeUrl(url: string): string {
  return url.replace(/["\\\r\n]/g, "");
}
