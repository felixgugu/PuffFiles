import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useScrollSpy } from "@/composables/useScrollSpy";
import { useBookmarksStore } from "@/stores/bookmarks";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import type { DocumentBookmark } from "@/types/bookmarks";
import type { OutlineItem, ViewerKind } from "@/types/viewer";
import { bookmarkLabel, type BookmarkSpot } from "@/utils/bookmarkAnchor";
import {
  BOOKMARK_FLASH_CLASS,
  docxAnchorFromSelection,
  resolveDocxAnchor,
} from "@/utils/docxBookmark";
import { resolveTextAnchor, textAnchorFromSelection } from "@/utils/textBookmark";
import { bookmarkKindOf, supportsViewerBookmarks } from "@/utils/viewer";

interface ViewerBookmarksOptions {
  paneId: PaneId;
  /** 目前這個檢視器的種類；不支援的種類（Markdown／HTML／圖片…）整組停用。 */
  kind: () => ViewerKind | null;
  /** 浮動面板的定位容器（檢視器根節點）。 */
  host: () => HTMLElement | null;
  /** 捲動容器（捲動同步與跳轉的座標系）。 */
  viewport: () => HTMLElement | null;
  /** 渲染後的內容根節點（DOCX 找區塊、純文字建立 Range）。 */
  content: () => HTMLElement | null;
  /** 純文字檢視器的文字來源（＝渲染出來的內容，不整份複製 DOM 文字）。 */
  text: () => string;
  /** 內容大小（位元組）；純文字的書籤有大小上限。 */
  size: () => number;
  /** 重新渲染的訊號；換了就要重新對位置。 */
  revision: () => unknown;
  /** 目前這份文件的路徑（書籤以路徑為鍵）。 */
  path: () => string;
}

/** 標示停留的時間：夠看到「就是這一段」，又不至於一直閃。 */
const FLASH_MS = 1400;

/**
 * 檢視器書籤：把「選取的文字」變成可以跳回來的位置。
 *
 * DOCX 沒有目錄、純文字也沒有大綱，所以目錄由使用者自己累積：選取文字 → 記下位置
 * → 之後從面板跳回去。兩種內容的錨點與對位規則分別在 `utils/docxBookmark.ts` 與
 * `utils/textBookmark.ts`（只差在「用什麼當位置」），這裡負責與 store、面板、鍵盤的接線。
 */
export function useViewerBookmarks(options: ViewerBookmarksOptions) {
  const bookmarks = useBookmarksStore();
  const settings = useSettingsStore();
  const ui = useUiStore();
  const viewer = useViewerStore();

  const items = computed(() => bookmarks.itemsFor(options.path()));
  /** 這一輪 DOM 對到的位置；重新渲染之後整批換新（`shallowRef` 讓 computed 跟著更新）。 */
  const located = shallowRef(new Map<string, BookmarkSpot | null>(new Map()));
  /** 目前有沒有「可以加入書籤」的選取範圍（決定加入鈕能不能按）。 */
  const canAdd = ref(false);
  /** 這個檢視器種類與內容大小能不能用書籤。 */
  const enabled = computed(() => supportsViewerBookmarks(options.kind(), options.size()));

  function locate() {
    const next = new Map<string, BookmarkSpot | null>();
    for (const item of items.value) {
      next.set(item.id, locateOne(item));
    }
    located.value = next;
    updateCanAdd();
  }

  /**
   * 把一個書籤對回目前的內容。
   *
   * 錨點種類與目前的檢視器不符（例如檔案從 .txt 變成 .docx）時直接視為失效：
   * 兩種座標系（區塊 vs 整份文字的位移）不能互相比對。
   */
  function locateOne(item: DocumentBookmark): BookmarkSpot | null {
    const kind = bookmarkKindOf(options.kind());
    if (!kind || item.anchor.kind !== kind) {
      return null;
    }
    if (kind === "docx" && item.anchor.kind === "docx") {
      return resolveDocxAnchor(options.content(), item.anchor);
    }
    if (kind === "text" && item.anchor.kind === "text") {
      return resolveTextAnchor(options.content(), options.text(), item.anchor);
    }
    return null;
  }

  /** 選取範圍要在這份內容裡才算數（分割時另一邊的選取不算）。 */
  function updateCanAdd() {
    const content = options.content();
    const selection = content?.ownerDocument.getSelection() ?? null;
    canAdd.value = Boolean(
      enabled.value &&
        content &&
        selection &&
        !selection.isCollapsed &&
        selection.anchorNode &&
        content.contains(selection.anchorNode),
    );
  }

  watch(
    [() => options.revision(), items, enabled],
    () => void nextTick(locate),
    { immediate: true, flush: "post" },
  );

  const spy = useScrollSpy({
    root: () => options.viewport(),
    ids: computed(() => items.value.map((item) => item.id)),
    resolve: (id) => located.value.get(id)?.target ?? null,
    revision: () => located.value,
  });

  /** 面板要的清單：書籤名稱、位置對不上時標成失效。 */
  const panelItems = computed<OutlineItem[]>(() =>
    items.value.map((item) => ({
      id: item.id,
      text: item.label,
      level: 1,
      stale: located.value.has(item.id) && located.value.get(item.id) === null,
    })),
  );

  /** 依序跳回書籤：先標示選取的那段文字，再捲到定位，DOCX 另外閃一下所在的區塊。 */
  function jumpTo(id: string) {
    const spot = located.value.get(id) ?? null;
    const viewport = options.viewport();
    if (!spot || !viewport) {
      ui.showNotice("找不到這個書籤的位置（文件可能已修改）");
      return;
    }
    if (spot.range) {
      const selection = viewport.ownerDocument.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(spot.range);
    }
    // 先選取再捲動：捲動才是最後寫入的狀態（選取本身也可能讓容器自己捲）。
    spy.jumpTo(id);
    // 焦點放進內容區，選取範圍才會用「作用中」的顏色畫出來。
    viewport.focus({ preventScroll: true, focusVisible: false });
    if (spot.flash) {
      flash(spot.flash);
    }
  }

  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  function flash(element: Element) {
    element.classList.remove(BOOKMARK_FLASH_CLASS);
    // 先移除、讀一次版面，再加回去：連續跳同一段時樣式才會真的重新套用
    //（中間沒有讀取的話，瀏覽器會把兩次改動合併，看起來像沒反應）。
    void (element as HTMLElement).offsetWidth;
    element.classList.add(BOOKMARK_FLASH_CLASS);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => element.classList.remove(BOOKMARK_FLASH_CLASS), FLASH_MS);
  }

  /** 把目前的選取範圍加成書籤（面板的加入鈕與 Ctrl+B）。 */
  function addFromSelection(): boolean {
    const content = options.content();
    const kind = bookmarkKindOf(options.kind());
    if (!content || !kind || !enabled.value) {
      ui.showNotice(
        kind ? "檔案過大，這個檢視器不支援書籤" : "這個檢視器沒有書籤目錄",
      );
      return false;
    }
    const selection = content.ownerDocument.getSelection();
    const anchor =
      kind === "docx"
        ? docxAnchorFromSelection(content, selection)
        : textAnchorFromSelection(content, options.text(), selection);
    if (!anchor) {
      ui.showNotice("請先在內容裡選取文字，再加入書籤");
      return false;
    }
    const path = options.path();
    if (!path) {
      return false;
    }
    if (bookmarks.has(path, anchor)) {
      ui.showNotice("這一段已經是書籤了");
      return false;
    }
    bookmarks.add(path, anchor, bookmarkLabel(anchor.text));
    // 面板關著就看不到剛加進去的書籤，加入時直接打開。
    if (!settings.viewerBookmarksEnabled) {
      settings.setViewerBookmarks(true);
    }
    ui.showNotice("已加入書籤");
    return true;
  }

  /** 重新命名（列上的鉛筆）：沿用既有的輸入對話框。 */
  async function rename(id: string) {
    const path = options.path();
    const item = items.value.find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    const label = await ui.prompt({
      title: "重新命名書籤",
      label: "名稱",
      value: item.label,
      selectTo: item.label.length,
    });
    if (label === null) {
      return;
    }
    bookmarks.rename(path, id, label.trim() || item.label);
  }

  /** 刪除：不跳確認對話框，改成通知上的「復原」——單筆書籤刪錯的代價很小。 */
  function remove(id: string) {
    const path = options.path();
    const removed = bookmarks.remove(path, id);
    if (!removed) {
      return;
    }
    ui.showNotice(
      `已刪除書籤「${removed.label}」`,
      { label: "復原", run: () => bookmarks.restore(path, removed) },
      5000,
    );
  }

  // Ctrl+B 由全域快速鍵轉送進來（內容區的選取範圍只有這裡拿得到）。
  watch(
    () => viewer.bookmarkRequests[options.paneId] ?? 0,
    () => addFromSelection(),
  );

  const onSelectionChange = () => updateCanAdd();

  onMounted(() => {
    document.addEventListener("selectionchange", onSelectionChange);
    void nextTick(locate);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("selectionchange", onSelectionChange);
    clearTimeout(flashTimer);
  });

  return {
    enabled,
    panelItems,
    activeId: spy.activeId,
    canAdd,
    jumpTo,
    addFromSelection,
    rename,
    remove,
  };
}
