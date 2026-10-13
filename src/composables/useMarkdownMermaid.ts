import { revealPath, saveBinaryFile } from "@/services/api";
import { copyText } from "@/services/clipboard";
import { normalizeBackendError } from "@/services/errors";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { ICON_PATHS, type IconName } from "@/components/common/icons";
import {
  applyDiagramZoom,
  fitDiagramToContent,
  mermaidConfig,
  nextDiagramZoom,
} from "@/utils/mermaid";
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
/** `Ctrl+滾輪`要累積多少像素才跳一級（10%）縮放（一個滑鼠段落的 `deltaY` 約 100）。 */
const WHEEL_STEP_PX = 100;

const SVG_NS = "http://www.w3.org/2000/svg";

/** 圖表列用的內嵌圖示；屬性與 `AppIcon.vue` 一致（同一組 24×24 path）。 */
function iconElement(name: IconName, size = 14): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICON_PATHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** 滾輪位移換算成像素：`deltaMode` 是行或頁時要自己乘開才跟滑鼠段落同一個尺度。 */
function wheelPixels(event: WheelEvent): number {
  if (event.deltaMode === 1) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === 2) {
    return event.deltaY * 100;
  }
  return event.deltaY;
}

/**
 * 這個軸向上真正捲得動的元素（自己捲不動就往上找最近一個捲得動的祖先）。
 *
 * 圖表區的高度等於圖高，所以它只會水平捲動；縱向要交給外層的檢視器容器。上層的
 * `.md-mermaid` 是 `overflow: hidden`（只是裁圓角），使用者捲不動，要跳過。
 */
function scrollerFor(from: HTMLElement, axis: "x" | "y"): HTMLElement | null {
  for (let node: HTMLElement | null = from; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const overflow = axis === "x" ? style.overflowX : style.overflowY;
    if (overflow !== "auto" && overflow !== "scroll") {
      continue;
    }
    const over =
      axis === "x" ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;
    if (over > 1) {
      return node;
    }
  }
  return null;
}

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

export function useMarkdownMermaid(options: {
  root: () => HTMLElement | null;
  /** 目前文件路徑；換檔時清掉切換狀態。 */
  path: () => string;
}) {
  const settings = useSettingsStore();
  const ui = useUiStore();

  /** 目前顯示原始碼的區塊（鍵＝序號＋原始碼雜湊）；換檔清空。 */
  const showingSource = new Set<string>();
  /**
   * 每個圖表自己的縮放倍率與內層捲動位置（鍵同上）；換檔清空。
   *
   * 記著捲動位置是為了重新渲染（切換主題、來回切「顯示原始碼」）之後回到同一個角落，
   * 不然放大到某處再切主題就會被彈回左上角。
   */
  const diagramView = new Map<string, { zoom: number; left: number; top: number }>();
  /** 拖曳平移模式：整份文件共用一個開關，換檔重設為關閉。 */
  let panMode = false;
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

  /** 這個圖表目前的倍率（沒設定＝自然尺寸 100%）。 */
  function zoomOf(wrapper: HTMLElement): number {
    return diagramView.get(wrapper.dataset.mermaidKey ?? "")?.zoom ?? 1;
  }

  /** 記住這個圖表的倍率與內層捲動位置（重新渲染時要還原）；沒給倍率就沿用記著的。 */
  function rememberView(view: HTMLElement, zoom?: number) {
    const key = view.closest<HTMLElement>(".md-mermaid")?.dataset.mermaidKey;
    if (!key) {
      return;
    }
    const saved = diagramView.get(key) ?? { zoom: 1, left: 0, top: 0 };
    const next = { zoom: zoom ?? saved.zoom, left: view.scrollLeft, top: view.scrollTop };
    diagramView.set(key, next);
  }

  /** 讀數與兩端按鈕的啟用狀態跟著倍率走。 */
  function paintZoom(wrapper: HTMLElement, zoom: number) {
    const value = query<HTMLElement>(wrapper, '[data-mermaid-action="zoom-reset"]');
    if (value) {
      value.textContent = `${Math.round(zoom * 100)}%`;
    }
    const out = query<HTMLButtonElement>(wrapper, '[data-mermaid-action="zoom-out"]');
    const into = query<HTMLButtonElement>(wrapper, '[data-mermaid-action="zoom-in"]');
    if (out) {
      out.disabled = nextDiagramZoom(zoom, -1) === zoom;
    }
    if (into) {
      into.disabled = nextDiagramZoom(zoom, 1) === zoom;
    }
  }

  /**
   * 套用倍率：改 SVG 大小，再把捲動位置補償到「錨點不跑掉」，最後記住狀態。
   *
   * 錨點是畫面上的一點（按鈕＝可視範圍中心、`Ctrl+滾輪`＝游標）：先算出它在圖表裡的
   * 相對位置，縮放後把捲動位置往同一點推回去。全程用畫面矩形推算，所以不用管容器的
   * 內距與捲軸寬度。
   */
  function setZoom(
    wrapper: HTMLElement,
    view: HTMLElement,
    zoom: number,
    anchor?: { x: number; y: number },
  ) {
    const svg = query<SVGSVGElement>(wrapper, ".md-mermaid-view svg");
    const before = svg?.getBoundingClientRect();
    if (!svg || !before || before.width <= 0 || before.height <= 0) {
      return;
    }
    const frame = view.getBoundingClientRect();
    const point =
      anchor ?? { x: frame.left + view.clientWidth / 2, y: frame.top + view.clientHeight / 2 };
    const ratioX = (point.x - before.left) / before.width;
    const ratioY = (point.y - before.top) / before.height;

    applyDiagramZoom(svg, zoom);

    // 水平是圖表區自己捲、垂直是外層容器捲（見 `scrollerFor`），兩邊都要補償。
    const after = svg.getBoundingClientRect();
    const scrollX = scrollerFor(view, "x");
    const scrollY = scrollerFor(view, "y");
    if (scrollX) {
      scrollX.scrollLeft += after.left + after.width * ratioX - point.x;
    }
    if (scrollY) {
      scrollY.scrollTop += after.top + after.height * ratioY - point.y;
    }

    rememberView(view, zoom);
    paintZoom(wrapper, zoom);
  }

  /** 往階梯的上一級／下一級；兩端時原封不動。 */
  function stepZoom(
    wrapper: HTMLElement,
    view: HTMLElement,
    direction: 1 | -1,
    anchor?: { x: number; y: number },
  ) {
    const current = zoomOf(wrapper);
    const next = nextDiagramZoom(current, direction);
    if (next !== current) {
      setZoom(wrapper, view, next, anchor);
    }
  }

  /**
   * 圖表顯示出來之後才能量尺寸（`fitDiagramToContent()` 需要 layout），這裡是唯一的
   * 入口：先依內容修好 viewBox，再套回這個圖表的倍率與捲動位置。
   */
  function fitAndZoom(wrapper: HTMLElement) {
    const view = query<HTMLElement>(wrapper, ".md-mermaid-view");
    const svg = query<SVGSVGElement>(wrapper, ".md-mermaid-view svg");
    if (!view || !svg) {
      return;
    }
    fitDiagramToContent(svg);
    const saved = diagramView.get(wrapper.dataset.mermaidKey ?? "");
    if (saved) {
      applyDiagramZoom(svg, saved.zoom);
      view.scrollLeft = saved.left;
      view.scrollTop = saved.top;
    }
    paintZoom(wrapper, saved?.zoom ?? 1);
  }

  /** 把平移模式的狀態畫到某一張圖上（新外殼建立、以及切換開關時都要跑）。 */
  function syncPan(wrapper: HTMLElement) {
    const view = query<HTMLElement>(wrapper, ".md-mermaid-view");
    const button = query<HTMLElement>(wrapper, '[data-mermaid-action="pan"]');
    if (view) {
      view.classList.toggle("is-pan", panMode);
    }
    if (button) {
      button.setAttribute("aria-pressed", String(panMode));
    }
  }

  /**
   * 拖曳平移與 `Ctrl+滾輪` 縮放。
   *
   * 只有開啟平移模式時才接手：關閉時左鍵拖曳照舊選取圖表裡的文字、`Ctrl+滾輪` 完全
   * 不攔截。`preventDefault()` 只下在 `pointerdown`（抑制文字選取與原生拖曳），
   * **不 `stopPropagation()`** —— 窗格焦點是靠 `BrowserPane` 的 pointerdown 冒泡決定的。
   * 觸控交給原生捲動（有慣性，比自己做的好），所以不接管 `pointerType === "touch"`。
   */
  function attachPan(view: HTMLElement) {
    let pointerId: number | null = null;
    let origin = { x: 0, y: 0, left: 0, top: 0 };
    let scrollX: HTMLElement | null = null;
    let scrollY: HTMLElement | null = null;

    view.addEventListener("pointerdown", (event) => {
      if (!panMode || event.button !== 0 || event.pointerType === "touch") {
        return;
      }
      pointerId = event.pointerId;
      scrollX = scrollerFor(view, "x");
      scrollY = scrollerFor(view, "y");
      origin = {
        x: event.clientX,
        y: event.clientY,
        left: scrollX?.scrollLeft ?? 0,
        top: scrollY?.scrollTop ?? 0,
      };
      view.classList.add("is-panning");
      view.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    view.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) {
        return;
      }
      if (scrollX) {
        scrollX.scrollLeft = origin.left - (event.clientX - origin.x);
      }
      if (scrollY) {
        scrollY.scrollTop = origin.top - (event.clientY - origin.y);
      }
    });

    const end = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) {
        return;
      }
      pointerId = null;
      view.classList.remove("is-panning");
      rememberView(view);
    };
    view.addEventListener("pointerup", end);
    view.addEventListener("pointercancel", end);

    let wheelPixelsPending = 0;
    view.addEventListener(
      "wheel",
      (event) => {
        if (!panMode || !event.ctrlKey) {
          return;
        }
        event.preventDefault();
        wheelPixelsPending += wheelPixels(event);
        if (Math.abs(wheelPixelsPending) < WHEEL_STEP_PX) {
          return;
        }
        // 一次事件只跳一級（滑鼠段落＝一級）；剩下的位移不累積，免得觸控板一甩跑好幾級。
        const direction: 1 | -1 = wheelPixelsPending < 0 ? 1 : -1;
        wheelPixelsPending = 0;
        const wrapper = view.closest<HTMLElement>(".md-mermaid");
        if (wrapper) {
          stepZoom(wrapper, view, direction, { x: event.clientX, y: event.clientY });
        }
      },
      { passive: false },
    );
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

  /** 圖示型的工具鈕（縮放、平移開關）：樣式與檢視器標頭的圖示鈕同一套。 */
  function toolButton(action: string, icon: IconName, title: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "md-mermaid-action md-mermaid-tool";
    button.dataset.mermaidAction = action;
    button.title = title;
    button.append(iconElement(icon));
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

    const pan = toolButton("pan", "hand", "拖曳平移：開啟後可以用滑鼠抓住圖表移動，Ctrl+滾輪縮放");
    pan.setAttribute("aria-pressed", "false");
    const zoomOut = toolButton("zoom-out", "minus", "縮小圖表");
    const zoomIn = toolButton("zoom-in", "plus", "放大圖表");
    const zoomValue = actionButton("zoom-reset", "100%", "回到原始大小（100%）");
    zoomValue.classList.add("md-mermaid-zoom-value");
    const toggle = actionButton("toggle", "顯示原始碼", "在圖表與原始碼之間切換");
    const save = actionButton("save", "另存圖片", "把圖表另存為 PNG");
    // 跟圖表本體有關的動作都要等真的渲染出來（`enableDiagram`）才出現。
    for (const button of [pan, zoomOut, zoomValue, zoomIn, toggle, save]) {
      button.hidden = true;
    }
    actions.append(
      pan,
      zoomOut,
      zoomValue,
      zoomIn,
      toggle,
      actionButton("copy", "複製", "複製 Mermaid 原始碼"),
      save,
    );
    bar.append(title, actions);

    const view = document.createElement("div");
    view.className = "md-mermaid-view";
    view.hidden = true;
    // 圖表是「畫面上的一張圖」，裡面的 SVG 文字不進檢視器搜尋（也不去改 SVG DOM）。
    view.dataset.searchSkip = "";
    attachPan(view);

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
    // 縮放與平移只對圖表本體有意義，看原始碼時整組收起來。
    for (const action of ["pan", "zoom-out", "zoom-reset", "zoom-in"]) {
      const button = query<HTMLElement>(wrapper, `[data-mermaid-action="${action}"]`);
      if (button) {
        button.hidden = sourceMode;
      }
    }
  }

  function enableDiagram(wrapper: HTMLElement) {
    wrapper.classList.add("has-diagram");
    for (const button of Array.from(
      wrapper.querySelectorAll<HTMLElement>("[data-mermaid-action]"),
    )) {
      button.hidden = false;
    }
    syncPan(wrapper);
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
    /*
     * 只有「換到另一份真的路徑」才清空狀態。重新載入（F5）或換檔的過程中，
     * 檢視器狀態會短暫消失、`path` 變成空字串 —— 那時候清空會把同一份文件的倍率、
     * 捲動位置與平移模式全部丟掉（換檔時本來就會換一個 composable 實例，
     * 所以不需要靠空字串來重置）。
     */
    if (path && path !== currentPath) {
      currentPath = path;
      showingSource.clear();
      diagramView.clear();
      panMode = false;
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
          // 設定集中在 `utils/mermaid.ts`，量測工具用的是同一份（見該檔的說明）。
          api.initialize(mermaidConfig(settings.isDark));
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
        view.classList.remove("md-mermaid-message");
        enableDiagram(wrapper);
        /*
         * 尺寸量測放在「圖表已經可見」之後：外殼建立時圖表區是隱藏的（一開始顯示原始碼），
         * `getScreenCTM()` 對 `display: none` 的內容回 null，量不到東西就會退回 mermaid
         * 原本的 viewBox。這裡沒有畫面閃爍的問題 —— 顯示、量測、改尺寸都在同一個任務裡
         * 完成，瀏覽器還沒機會繪製。倍率一定疊在修好的 viewBox 之後（交給 fitAndZoom）。
         */
        fitAndZoom(wrapper);
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
      const outcome = await saveBinaryFile(name, bytes, "png");
      if (!outcome.saved) {
        return;
      }
      ui.showNotice("圖表已儲存");
      await revealSaved(outcome.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.showNotice(`另存圖片失敗：${message}`);
    }
  }

  /**
   * 存檔後打開檔案總管並選取剛存的那個檔（與檢視器標頭的「在檔案總管中顯示」同一條）。
   *
   * 瀏覽器預覽模式沒有路徑（也沒有檔案總管）就跳過。開啟失敗不該蓋掉「已儲存」這個
   * 結果 —— 檔案已經在磁碟上了 —— 所以自己 catch 起來另外通知。
   */
  async function revealSaved(path: string | null) {
    if (!path) {
      return;
    }
    try {
      await revealPath(path);
    } catch (error) {
      ui.showNotice(normalizeBackendError(error).message);
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
        // 從原始碼切回圖表時補量一次尺寸：顯示原始碼的那一輪圖表區是隱藏的，量不到內容。
        if (!next) {
          fitAndZoom(wrapper);
        }
        const key = wrapper.dataset.mermaidKey ?? "";
        if (next) {
          showingSource.add(key);
        } else {
          showingSource.delete(key);
        }
        return;
      }
      case "zoom-in":
      case "zoom-out": {
        const view = query<HTMLElement>(wrapper, ".md-mermaid-view");
        if (view) {
          stepZoom(wrapper, view, button.dataset.mermaidAction === "zoom-in" ? 1 : -1);
        }
        return;
      }
      case "zoom-reset": {
        const view = query<HTMLElement>(wrapper, ".md-mermaid-view");
        if (view && zoomOf(wrapper) !== 1) {
          setZoom(wrapper, view, 1);
        }
        return;
      }
      case "pan": {
        panMode = !panMode;
        const root = options.root();
        if (root) {
          for (const block of Array.from(root.querySelectorAll<HTMLElement>(".md-mermaid"))) {
            syncPan(block);
          }
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
