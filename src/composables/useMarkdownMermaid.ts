import { saveBinaryFile } from "@/services/api";
import { copyText } from "@/services/clipboard";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { fileNameOf } from "@/utils/path";

/**
 * Markdown 檢視器的 Mermaid 圖表。
 *
 * `utils/markdown.ts` 對 ```mermaid 圍籬維持零依賴的純函式輸出（`<pre>` ＋
 * `class="language-mermaid"`）；這裡在內容渲染進 DOM 之後接手，把每個區塊換成
 * 「圖表／原始碼」可各自切換的容器。圖表用官方 mermaid 產生**內嵌 SVG**，
 * 只有真的出現 mermaid 區塊才 lazy 載入引擎（沒有圖的文件完全不付代價）。
 *
 * 任何一步失敗都保留原始碼並在圖表區顯示原因 —— 沿用「檢視器絕不空白」原則。
 * 換一份文件時「顯示原始碼」的切換狀態會清空；同一份文件內重新整理則保留。
 */

/** 單一區塊原始碼的上限（bytes）；超過就只顯示原始碼。 */
export const MAX_MERMAID_BYTES = 200 * 1024;
/** 一份文件最多渲染的圖表數；超出的區塊只顯示原始碼。 */
export const MAX_MERMAID_DIAGRAMS = 50;
/** 另存 PNG 的縮放倍率（HiDPI 螢幕才不會糊）。 */
const EXPORT_SCALE = 2;
/** 匯出 PNG 的長邊上限（px）；canvas 過大會直接失敗。 */
const MAX_EXPORT_PX = 8192;

type MermaidApi = (typeof import("mermaid"))["default"];

let apiPromise: Promise<MermaidApi> | null = null;

/** 引擎只在第一次遇到 mermaid 區塊時載入一次。 */
function loadMermaid(): Promise<MermaidApi> {
  apiPromise ??= import("mermaid").then((module) => module.default);
  return apiPromise;
}

/** 穩定、短的字串雜湊；用來當「目前顯示原始碼」的鍵（換檔仍能對到同一個區塊）。 */
function hashSource(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

/** 檔名不能出現的字元換成底線；空字串則退回 `mermaid`。 */
function safeStem(path: string): string {
  const name = fileNameOf(path);
  const stem = name.replace(/\.[^.]+$/, "") || "mermaid";
  return stem.replace(/[\\/:*?"<>|]+/g, "_");
}

/** 圖表在 mermaid 眼中的自然尺寸（viewBox）；沒有 viewBox 時退回畫面上的量測值。 */
function naturalSize(svg: SVGSVGElement): { width: number; height: number } {
  const box = svg.viewBox.baseVal;
  const rect = svg.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(box.width > 0 ? box.width : rect.width)),
    height: Math.max(1, Math.round(box.height > 0 ? box.height : rect.height)),
  };
}

/**
 * 讓圖表以 mermaid 算出的自然尺寸呈現，而不是被拉成窗格寬。
 *
 * mermaid 預設輸出 `width="100%"` 加上 inline `max-width`（＝自然寬度）：窗格比圖窄時
 * 整張圖會被等比縮小，愈縮愈長也愈難讀。這裡把 `width`／`height` 寫成 viewBox 的內在
 * 尺寸、拿掉 inline `max-width`，超出的部分交給 `.md-mermaid-view` 的自動捲軸處理。
 * 因為寫死的是自然尺寸，比窗格小的圖也不會被放大。
 */
function applyNaturalSize(svg: SVGSVGElement) {
  const box = svg.viewBox.baseVal;
  if (!box || box.width <= 0 || box.height <= 0) {
    return;
  }
  svg.setAttribute("width", String(Math.round(box.width)));
  svg.setAttribute("height", String(Math.round(box.height)));
  // inline `max-width` 會蓋掉 CSS 的尺寸規則，一定要移除。
  svg.style.removeProperty("max-width");
  svg.style.removeProperty("width");
  svg.style.removeProperty("height");
}

export function useMarkdownMermaid(options: {
  root: () => HTMLElement | null;
  /** 目前文件路徑；換檔時清掉切換狀態。 */
  path: () => string;
}) {
  const settings = useSettingsStore();
  const ui = useUiStore();

  /** 目前顯示原始碼的區塊（鍵＝序號＋原始碼雜湊）；換檔清空。 */
  const showingSource = new Set<string>();
  let currentPath: string | null = null;
  let pass = 0;

  function query<T extends Element>(wrapper: HTMLElement, selector: string): T | null {
    return wrapper.querySelector<T>(selector);
  }

  /** 把先前插入的容器拆回單純的 `<pre>`，讓每輪重建都從乾淨的 DOM 開始。 */
  function unwrapAll(root: HTMLElement) {
    for (const wrapper of Array.from(root.querySelectorAll<HTMLElement>(".md-mermaid"))) {
      const pre = query<HTMLElement>(wrapper, ":scope > pre.md-mermaid-source");
      if (pre) {
        pre.classList.remove("md-mermaid-source");
        pre.hidden = false;
        pre.removeAttribute("data-search-skip");
        wrapper.replaceWith(pre);
      } else {
        wrapper.remove();
      }
    }
  }

  function actionButton(action: string, label: string, title: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "md-mermaid-action";
    button.dataset.mermaidAction = action;
    button.textContent = label;
    button.title = title;
    return button;
  }

  /** 建立外殼（標題列＋圖表區＋原始碼），一開始維持顯示原始碼。 */
  function wrap(pre: HTMLElement, key: string, index: number): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "md-mermaid";
    wrapper.dataset.mermaidKey = key;
    wrapper.dataset.mermaidIndex = String(index);

    const bar = document.createElement("div");
    bar.className = "md-mermaid-bar";
    // 面板自己的文字（標題、按鈕）不是文件內容，不該被檢視器搜尋。
    bar.dataset.searchSkip = "";
    const title = document.createElement("span");
    title.className = "md-mermaid-title";
    title.textContent = "Mermaid";
    const actions = document.createElement("div");
    actions.className = "md-mermaid-actions";

    const toggle = actionButton("toggle", "顯示原始碼", "在圖表與原始碼之間切換");
    const save = actionButton("save", "另存圖片", "把圖表另存為 PNG");
    toggle.hidden = true;
    save.hidden = true;
    actions.append(toggle, actionButton("copy", "複製", "複製 Mermaid 原始碼"), save);
    bar.append(title, actions);

    const view = document.createElement("div");
    view.className = "md-mermaid-view";
    view.hidden = true;
    // 圖表是「畫面上的一張圖」，裡面的 SVG 文字不進檢視器搜尋（也不去改 SVG DOM）。
    view.dataset.searchSkip = "";

    pre.classList.add("md-mermaid-source");
    pre.hidden = false;

    // 先把外殼放到 pre 的位置，再把 pre 收進外殼（順序反了會「新子節點包含父節點」）。
    wrapper.append(bar, view);
    pre.replaceWith(wrapper);
    wrapper.append(pre);
    return wrapper;
  }

  /** 在「圖表」與「原始碼」之間切換；收合時原始碼不該被搜尋到。 */
  function applyMode(wrapper: HTMLElement, sourceMode: boolean) {
    const view = query<HTMLElement>(wrapper, ".md-mermaid-view");
    const pre = query<HTMLElement>(wrapper, "pre.md-mermaid-source");
    wrapper.classList.toggle("is-source", sourceMode);
    if (view) {
      view.hidden = sourceMode;
    }
    if (pre) {
      pre.hidden = !sourceMode;
      if (sourceMode) {
        pre.removeAttribute("data-search-skip");
      } else {
        pre.setAttribute("data-search-skip", "");
      }
    }
    const toggle = query<HTMLElement>(wrapper, '[data-mermaid-action="toggle"]');
    if (toggle) {
      const label = sourceMode ? "顯示圖表" : "顯示原始碼";
      toggle.textContent = label;
      toggle.title = label;
    }
    const save = query<HTMLElement>(wrapper, '[data-mermaid-action="save"]');
    if (save) {
      save.hidden = sourceMode;
    }
  }

  function enableDiagram(wrapper: HTMLElement) {
    wrapper.classList.add("has-diagram");
    const toggle = query<HTMLElement>(wrapper, '[data-mermaid-action="toggle"]');
    const save = query<HTMLElement>(wrapper, '[data-mermaid-action="save"]');
    if (toggle) {
      toggle.hidden = false;
    }
    if (save) {
      save.hidden = false;
    }
    applyMode(wrapper, showingSource.has(wrapper.dataset.mermaidKey ?? ""));
  }

  /** 略過或失敗時：原始碼維持可見，圖表區顯示一行說明、不提供切換。 */
  function showMessage(wrapper: HTMLElement, message: string) {
    const view = query<HTMLElement>(wrapper, ".md-mermaid-view");
    const pre = query<HTMLElement>(wrapper, "pre.md-mermaid-source");
    wrapper.classList.remove("has-diagram", "is-source");
    if (view) {
      view.hidden = false;
      view.textContent = message;
      view.classList.add("md-mermaid-message");
    }
    if (pre) {
      pre.hidden = false;
      pre.setAttribute("data-search-skip", "");
    }
  }

  /** 重建所有 mermaid 區塊；`pass` 讓過期的非同步結果自動作廢。 */
  async function renderAll(): Promise<void> {
    const root = options.root();
    if (!root) {
      return;
    }

    const path = options.path();
    if (path !== currentPath) {
      currentPath = path;
      showingSource.clear();
    }

    const myPass = ++pass;
    unwrapAll(root);

    const codes = Array.from(
      root.querySelectorAll<HTMLElement>("pre.md-pre > code.language-mermaid"),
    );
    if (!settings.mermaidEnabled || codes.length === 0) {
      return;
    }

    const wrappers = codes.map((code, index) => {
      const pre = code.parentElement;
      if (!pre) {
        return null;
      }
      const source = code.textContent ?? "";
      const key = `${index}:${hashSource(source)}`;
      return { wrapper: wrap(pre, key, index), source, index };
    });

    let api: MermaidApi | null = null;

    for (const entry of wrappers) {
      if (!entry || myPass !== pass) {
        return;
      }
      const { wrapper, source, index } = entry;

      if (index >= MAX_MERMAID_DIAGRAMS) {
        showMessage(wrapper, "圖表數量過多，已略過渲染");
        continue;
      }
      if (new Blob([source]).size > MAX_MERMAID_BYTES) {
        showMessage(wrapper, "圖表原始碼過大，已略過渲染");
        continue;
      }

      if (!api) {
        try {
          api = await loadMermaid();
          if (myPass !== pass) {
            return;
          }
          api.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            htmlLabels: false,
            suppressErrorRendering: true,
            theme: settings.isDark ? "dark" : "default",
          });
        } catch {
          if (myPass !== pass) {
            return;
          }
          showMessage(wrapper, "圖表引擎載入失敗，以下為原始碼");
          continue;
        }
      }

      const id = `pufffile-mermaid-${myPass}-${index}`;
      try {
        const { svg } = await api.render(id, source);
        if (myPass !== pass) {
          return;
        }
        const view = query<HTMLElement>(wrapper, ".md-mermaid-view");
        if (!view) {
          return;
        }
        view.innerHTML = svg;
        const svgElement = view.querySelector<SVGSVGElement>("svg");
        if (svgElement) {
          applyNaturalSize(svgElement);
        }
        view.classList.remove("md-mermaid-message");
        enableDiagram(wrapper);
      } catch (error) {
        if (myPass !== pass) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        showMessage(wrapper, message ? `圖表渲染失敗：${message}` : "圖表渲染失敗");
      } finally {
        document.getElementById(`d${id}`)?.remove();
      }
    }
  }

  /** 把內嵌 SVG 轉成 PNG bytes（先經過 canvas；字型與外框都跟畫面上一致）。 */
  async function rasterize(svg: SVGSVGElement): Promise<Uint8Array<ArrayBuffer>> {
    // 用 viewBox 的內在尺寸，而不是畫面大小：圖表可能比窗格大而被捲軸裁掉，
    // 直接拿可視範圍來匯出會變成低解析度、甚至只截到看得到的那一塊。
    const { width, height } = naturalSize(svg);
    const scale = Math.min(EXPORT_SCALE, MAX_EXPORT_PX / Math.max(width, height));

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    // 畫面用的 `max-width` 不該帶進匯出檔，否則在 <img> 裡可能被限制成小尺寸。
    clone.style.removeProperty("max-width");
    const markup = new XMLSerializer().serializeToString(clone);

    const url = URL.createObjectURL(
      new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
    );
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("無法把圖表轉成圖片"));
        image.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("無法建立畫布");
      }
      const styles = getComputedStyle(document.documentElement);
      context.fillStyle = styles.getPropertyValue("--color-canvas").trim() || "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.drawImage(image, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) {
        throw new Error("無法輸出 PNG");
      }
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function saveDiagram(wrapper: HTMLElement) {
    const svg = query<SVGSVGElement>(wrapper, ".md-mermaid-view svg");
    if (!svg) {
      return;
    }
    const index = Number(wrapper.dataset.mermaidIndex ?? "0");
    try {
      const bytes = await rasterize(svg);
      const name = `${safeStem(options.path())}-mermaid-${index + 1}.png`;
      const saved = await saveBinaryFile(name, bytes, "png");
      if (saved) {
        ui.showNotice("圖表已儲存");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.showNotice(`另存圖片失敗：${message}`);
    }
  }

  async function runAction(button: HTMLElement) {
    const wrapper = button.closest<HTMLElement>(".md-mermaid");
    if (!wrapper) {
      return;
    }
    switch (button.dataset.mermaidAction) {
      case "toggle": {
        const next = !wrapper.classList.contains("is-source");
        applyMode(wrapper, next);
        const key = wrapper.dataset.mermaidKey ?? "";
        if (next) {
          showingSource.add(key);
        } else {
          showingSource.delete(key);
        }
        return;
      }
      case "copy": {
        const source = query<HTMLElement>(wrapper, "pre.md-mermaid-source code")?.textContent ?? "";
        ui.showNotice((await copyText(source)) ? "已複製 Mermaid 原始碼" : "複製失敗");
        return;
      }
      case "save":
        await saveDiagram(wrapper);
        return;
      default:
        return;
    }
  }

  /** 內容根節點的 click 事件委派；回傳 true 代表這個點擊是面板按鈕、已處理。 */
  function handleClick(event: MouseEvent): boolean {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>("[data-mermaid-action]");
    if (!button) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    void runAction(button);
    return true;
  }

  return { renderAll, handleClick };
}
