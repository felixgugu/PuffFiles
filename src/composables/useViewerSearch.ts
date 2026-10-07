import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import {
  searchText,
  type SearchHit,
  type SearchOptions,
  type SearchResult,
} from "@/utils/textSearch";

/** 這些節點裡的文字不算內容（iframe 的樣式與標題、被移除的腳本等）。 */
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "HEAD", "TITLE", "NOSCRIPT", "LINK"]);
/**
 * 區塊元素：換一個區塊就在搜尋文字裡補一個換行。
 *
 * 渲染後的 HTML（Markdown／HTML 預覽）節點之間沒有空白，整份文件的文字會黏成
 * 一大串 —— 命中片段會跨過好幾個段落、行號也沒有意義。補上換行之後，片段
 * 只會取到附近的內容，`lineText` 也剛好等於「命中所在的那個區塊」。
 * 換行不屬於任何文字節點，所以位移對照表仍然精確。
 */
const BLOCK_SELECTOR =
  "p,h1,h2,h3,h4,h5,h6,li,ul,ol,div,pre,blockquote,table,tr,td,th,figure,figcaption,section,article,header,footer,dt,dd";
/** 邊打邊搜的去抖時間。 */
const QUERY_DEBOUNCE_MS = 150;
/** 注入 iframe 的命中樣式 id。 */
const FRAME_STYLE_ID = "pufffile-search-style";

const EMPTY_RESULT: SearchResult = { hits: [], truncated: false, tooLarge: false, error: null };

/** 一段文字節點在整份搜尋文字裡的範圍。 */
interface TextSlice {
  node: Text;
  start: number;
  end: number;
}

interface ViewerSearchOptions {
  paneId: PaneId;
  /** 搜尋的內容根節點（文字節點都在它底下）。 */
  root: () => HTMLElement | null;
  /** 內容變動訊號：換檔、重新渲染、iframe 載入完成。 */
  source: () => unknown;
  /** 命中列是否顯示行號（純文字／程式碼檢視器）。 */
  showLine: boolean;
}

/**
 * 檢視器搜尋：把「可見文字 + 三個選項」變成命中清單，並在內文標記與捲動。
 *
 * 搜尋的是畫面上真正看得到的文字節點（跳過 script／style／head），位移一律用
 * UTF-16 code unit，跟 `utils/textSearch.ts` 的座標系一致，所以命中可以直接
 * 對應回 DOM。標記會改動內文 DOM，因此每次重畫都先還原、重新走訪再上標；
 * `v-html` 重新渲染（換檔、重新載入）時舊標記自然消失，這裡再看 `source` 重跑。
 */
export function useViewerSearch(options: ViewerSearchOptions) {
  const viewer = useViewerStore();
  const settings = useSettingsStore();

  const state = computed(() => viewer.of(options.paneId));
  const open = computed(() => state.value?.search.open ?? false);
  const query = computed(() => state.value?.search.query ?? "");
  const flags = computed<SearchOptions>(() => ({
    caseSensitive: state.value?.search.caseSensitive ?? false,
    wholeWord: state.value?.search.wholeWord ?? false,
    regex: state.value?.search.regex ?? false,
  }));

  const result = ref<SearchResult>(EMPTY_RESULT);
  const activeIndex = ref(-1);
  const hits = computed(() => result.value.hits);

  /** 目前畫面上的命中元素（一筆命中跨節點時取第一段）。 */
  let elements: (HTMLElement | null)[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** 走訪可見文字節點，串成一份文字並記下每一段的位移。 */
  function collect(root: HTMLElement): { text: string; slices: TextSlice[] } {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const slices: TextSlice[] = [];
    let text = "";
    let block: Element | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) {
        continue;
      }
      // 被標為搜尋要略過的子樹（例如 Mermaid 圖表模式下收起的原始碼）不算內容。
      if (parent.closest("[data-search-skip]")) {
        continue;
      }
      const value = (node as Text).data;
      if (!value) {
        continue;
      }
      const nextBlock = parent.closest(BLOCK_SELECTOR);
      if (text && nextBlock && nextBlock !== block) {
        text += "\n";
      }
      block = nextBlock;
      slices.push({ node: node as Text, start: text.length, end: text.length + value.length });
      text += value;
    }
    return { text, slices };
  }

  /** 把上一次的標記還原成純文字（合併回同一個文字節點）。 */
  function clearMarks(root: HTMLElement) {
    const doc = root.ownerDocument;
    for (const mark of root.querySelectorAll("mark[data-search-hit]")) {
      const parent = mark.parentNode;
      if (!parent) {
        continue;
      }
      parent.replaceChild(doc.createTextNode(mark.textContent ?? ""), mark);
      parent.normalize();
    }
  }

  function wrap(node: Text, from: number, to: number, index: number, created: (HTMLElement | null)[]) {
    const doc = node.ownerDocument;
    // 先切右再切左：切完之後 node 是「命中之前」那段，mid 就是命中本身。
    node.splitText(to);
    const mid = node.splitText(from);
    const mark = doc.createElement("mark");
    mark.className = "search-hit";
    mark.dataset.searchHit = String(index);
    mid.replaceWith(mark);
    mark.appendChild(mid);
    if (!created[index]) {
      created[index] = mark;
    }
  }

  /** 依命中把文字節點切開並包上 `<mark>`；回傳每一筆命中的第一個元素。 */
  function applyMarks(slices: TextSlice[], list: SearchHit[]): (HTMLElement | null)[] {
    const created: (HTMLElement | null)[] = new Array(list.length).fill(null);
    // 命中與文字節點都依文件順序排好，兩邊各走一次就好（不要 O(命中 × 節點)）。
    const buckets = new Map<number, { index: number; from: number; to: number }[]>();
    let cursor = 0;
    for (let index = 0; index < list.length; index += 1) {
      const hit = list[index];
      while (cursor < slices.length && slices[cursor].end <= hit.start) {
        cursor += 1;
      }
      for (let at = cursor; at < slices.length && slices[at].start < hit.end; at += 1) {
        const slice = slices[at];
        const bucket = buckets.get(at) ?? [];
        bucket.push({
          index,
          from: Math.max(hit.start, slice.start) - slice.start,
          to: Math.min(hit.end, slice.end) - slice.start,
        });
        buckets.set(at, bucket);
      }
    }
    for (const [at, entries] of buckets) {
      // 由右往左切，左邊還沒處理的位移才不會被前面的切割影響。
      entries.sort((a, b) => b.from - a.from);
      for (const entry of entries) {
        wrap(slices[at].node, entry.from, entry.to, entry.index, created);
      }
    }
    return created;
  }

  /** iframe（非本文件）要自己注入命中樣式，父層的 CSS 進不去。 */
  function ensureFrameStyles(root: HTMLElement) {
    const doc = root.ownerDocument;
    if (doc === document || doc.getElementById(FRAME_STYLE_ID)) {
      return;
    }
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue("--color-accent").trim() || "#2563eb";
    const accentInk = styles.getPropertyValue("--color-accent-ink").trim() || "#ffffff";
    const style = doc.createElement("style");
    style.id = FRAME_STYLE_ID;
    style.textContent =
      "mark.search-hit{background:color-mix(in oklab, " +
      `${accent} 25%, transparent);color:inherit;border-radius:2px}` +
      `mark.search-hit-active{background:${accent};color:${accentInk}}`;
    doc.head?.appendChild(style);
  }

  function markActive() {
    const root = options.root();
    if (!root) {
      return;
    }
    for (const mark of root.querySelectorAll("mark.search-hit-active")) {
      mark.classList.remove("search-hit-active");
    }
    const index = activeIndex.value;
    if (index < 0) {
      return;
    }
    for (const mark of root.querySelectorAll(`mark[data-search-hit="${index}"]`)) {
      mark.classList.add("search-hit-active");
    }
  }

  function reveal() {
    const element = elements[activeIndex.value];
    element?.scrollIntoView({
      block: "center",
      behavior: settings.reduceMotion ? "auto" : "smooth",
    });
  }

  /** 重新走訪內容、比對、上標；`keepActive` 供內容變動時保留目前那一筆。 */
  function paint(keepActive: boolean) {
    const root = options.root();
    if (!root) {
      reset();
      return;
    }
    clearMarks(root);
    const { text, slices } = collect(root);
    const built = searchText(text, query.value, flags.value);
    result.value = built;
    elements = applyMarks(slices, built.hits);
    ensureFrameStyles(root);

    const count = built.hits.length;
    if (!count) {
      activeIndex.value = -1;
    } else if (keepActive && activeIndex.value >= 0) {
      activeIndex.value = Math.min(activeIndex.value, count - 1);
    } else {
      activeIndex.value = 0;
    }
    markActive();
  }

  function reset() {
    const root = options.root();
    if (root) {
      clearMarks(root);
    }
    elements = [];
    result.value = EMPTY_RESULT;
    activeIndex.value = -1;
  }

  function schedule(delay: number, keepActive: boolean) {
    clearTimeout(timer);
    const run = () => {
      timer = undefined;
      paint(keepActive);
    };
    if (delay > 0) {
      timer = setTimeout(run, delay);
    } else {
      void nextTick(run);
    }
  }

  function select(index: number, scroll = true) {
    const count = hits.value.length;
    if (!count) {
      activeIndex.value = -1;
      return;
    }
    activeIndex.value = ((index % count) + count) % count;
    markActive();
    if (scroll) {
      reveal();
    }
  }

  function setQuery(value: string) {
    viewer.updateSearch(options.paneId, { query: value });
  }

  function toggleFlag(name: keyof SearchOptions) {
    viewer.updateSearch(options.paneId, { [name]: !flags.value[name] });
  }

  // 邊打邊搜：字串與選項變動時去抖，內容變動時立刻重算。
  watch(
    [
      query,
      () => flags.value.caseSensitive,
      () => flags.value.wholeWord,
      () => flags.value.regex,
    ],
    () => {
      if (open.value) {
        schedule(QUERY_DEBOUNCE_MS, false);
      }
    },
  );
  watch(
    [() => options.root(), () => options.source()],
    () => {
      if (open.value) {
        schedule(0, true);
      }
    },
    { flush: "post" },
  );
  watch(
    open,
    (value) => {
      if (value) {
        void nextTick(() => paint(false));
      } else {
        reset();
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    clearTimeout(timer);
    reset();
  });

  return {
    open,
    query,
    flags,
    hits,
    activeIndex,
    result,
    showLine: options.showLine,
    setQuery,
    toggleFlag,
    select,
    next: () => select(activeIndex.value + 1),
    prev: () => select(activeIndex.value - 1),
  };
}
