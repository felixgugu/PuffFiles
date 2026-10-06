import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from "vue";
import { useDragGesture } from "@/composables/useDragGesture";
import { useSettingsStore } from "@/stores/settings";
import {
  clampPanel,
  clampPanelMinWidth,
  PANEL_MARGIN,
  PANEL_MIN_HEIGHT,
  PANEL_TITLEBAR_HEIGHT,
  type PanelLayout,
} from "@/utils/viewerPanel";

interface ViewerPanelOptions {
  /** 定位容器（檢視器的根節點）；量測可用範圍與夾邊界都用它。 */
  host: () => HTMLElement | null;
  /** 標題列以外的內容自然高度（清單捲動高度）。 */
  contentHeight: Ref<number>;
  collapsed: ComputedRef<boolean>;
  /** 開始時的記憶值（來自 settings）。 */
  initialLayout: PanelLayout;
  /** 拖曳／縮放結束時把新的位置與尺寸寫回。 */
  onPersist: (layout: PanelLayout) => void;
  /** 標題列的 Enter／空白＝收合或展開。 */
  onToggleCollapse: () => void;
  /**
   * 還沒被移動過（`x === null`，貼齊右上角）時要避開的元素；
   * 同一窗格的其他浮動面板（例如目錄索引）已經展開時往下讓開。
   */
  avoid?: () => HTMLElement | null;
}

/**
 * 檢視器浮動面板的位置、大小與拖曳手勢（目錄索引與搜尋共用）。
 *
 * 每個面板實例都有自己的工作副本，拖曳結束才寫回設定 —— 兩個窗格同時開
 * 同一個面板時，拖其中一個不會讓另一個跟著跳，新開的面板則沿用最後一次的
 * 設定值。所有數值在計算時就夾進可視範圍，面板永遠不會被拖出檢視器。
 */
export function useViewerPanel(options: ViewerPanelOptions) {
  const settings = useSettingsStore();
  const { host, contentHeight, collapsed, initialLayout, onPersist, onToggleCollapse, avoid } =
    options;

  const posX = ref<number | null>(initialLayout.x);
  const posY = ref(initialLayout.y);
  const panelWidth = ref(initialLayout.width);
  const panelHeight = ref<number | null>(initialLayout.height);
  const area = ref({ width: 0, height: 0 });

  /** 使用者在設定頁調的最小寬度（拖曳下限）。 */
  const minWidth = computed(() => clampPanelMinWidth(settings.viewerPanelMinWidth));

  /**
   * 避讓位移：只有「還沒被移動過」的面板才自動往下讓開。
   * 由 `area` 觸發重算 —— 量到尺寸時兩個面板都已經在 DOM 裡了。
   */
  const avoidOffset = computed(() => {
    if (posX.value !== null || !avoid || area.value.width <= 0) {
      return 0;
    }
    const other = avoid();
    const element = host();
    if (!other || !element || other.offsetParent === null) {
      return 0;
    }
    const otherRect = other.getBoundingClientRect();
    const hostRect = element.getBoundingClientRect();
    if (otherRect.height <= 0) {
      return 0;
    }
    return Math.max(0, Math.round(otherRect.bottom - hostRect.top + PANEL_MARGIN));
  });

  const bounds = computed(() => ({
    width: area.value.width,
    height: area.value.height,
    contentHeight: PANEL_TITLEBAR_HEIGHT + contentHeight.value + 2,
    minWidth: minWidth.value,
  }));

  const layout = computed<PanelLayout>(() => ({
    x: posX.value,
    y: posY.value + avoidOffset.value,
    width: panelWidth.value,
    height: panelHeight.value,
  }));

  /** `null`＝這個窗格太窄，不該顯示面板。 */
  const rect = computed(() => clampPanel(layout.value, bounds.value));

  const panelStyle = computed(() => {
    const box = rect.value;
    if (!box) {
      return undefined;
    }
    return {
      left: `${box.x + PANEL_MARGIN}px`,
      top: `${box.y + PANEL_MARGIN}px`,
      width: `${box.width}px`,
      height: `${collapsed.value ? PANEL_TITLEBAR_HEIGHT : box.height}px`,
    };
  });

  let observer: ResizeObserver | null = null;

  function measureArea() {
    const element = host();
    area.value = element
      ? { width: element.clientWidth, height: element.clientHeight }
      : { width: 0, height: 0 };
  }

  watch(
    host,
    (element) => {
      observer?.disconnect();
      observer = null;
      measureArea();
      if (!element) {
        return;
      }
      observer = new ResizeObserver(measureArea);
      observer.observe(element);
    },
    { immediate: true },
  );

  onBeforeUnmount(() => observer?.disconnect());

  function persist() {
    onPersist({
      x: posX.value,
      y: posY.value,
      width: panelWidth.value,
      height: panelHeight.value,
    });
  }

  let moveOrigin = { x: 0, y: 0 };

  /** 拖曳標題列＝移動面板；過程中即時夾在邊界內。 */
  const move = useDragGesture({
    onStart: () => {
      const box = rect.value;
      if (!box) {
        return;
      }
      // 第一次拖曳就把「右上角對齊」固化成絕對座標。
      posX.value = box.x;
      posY.value = box.y;
      moveOrigin = { x: box.x, y: box.y };
    },
    onMove: (state) => {
      const box = clampPanel(
        {
          x: moveOrigin.x + state.dx,
          y: moveOrigin.y + state.dy,
          width: panelWidth.value,
          height: panelHeight.value,
        },
        bounds.value,
      );
      if (!box) {
        return;
      }
      posX.value = box.x;
      posY.value = box.y;
    },
    onEnd: persist,
  });

  let resizeOrigin = { x: 0, y: 0, width: 0, height: 0 };

  /*
   * 左下角把手＝同時調整寬高。
   *
   * 面板用左上角定位，所以「右緣固定、左緣跟著手指」要把 x 一起改：寬度增加
   * 多少，x 就減少多少，把手才會 1:1 跟著指標。把手放在左下角而不是右下角，
   * 是因為面板預設貼齊右上角，右邊沒有空間時右下角把手往右拖完全不會變大；
   * 抓左下角時「往外拖」（往左、往下）一律是放大，預設位置就能直接調整。
   */
  function applyResize(widthDelta: number, heightDelta: number) {
    const current = bounds.value;
    // 右緣固定，所以寬度最多長到「右緣到檢視器左緣」的距離。
    const maxWidth = Math.max(minWidth.value, resizeOrigin.x + resizeOrigin.width);
    const maxHeight = Math.max(PANEL_MIN_HEIGHT, current.height - PANEL_MARGIN * 2 - resizeOrigin.y);
    const width = Math.min(Math.max(minWidth.value, resizeOrigin.width + widthDelta), maxWidth);
    const height = Math.min(Math.max(PANEL_MIN_HEIGHT, resizeOrigin.height + heightDelta), maxHeight);
    panelWidth.value = Math.round(width);
    panelHeight.value = Math.round(height);
    posX.value = Math.round(resizeOrigin.x + (resizeOrigin.width - width));
    posY.value = resizeOrigin.y;
  }

  const resize = useDragGesture({
    onStart: () => {
      const box = rect.value;
      if (!box) {
        return;
      }
      resizeOrigin = { x: box.x, y: box.y, width: box.width, height: box.height };
      posX.value = box.x;
      posY.value = box.y;
    },
    // 往左拖（dx < 0）＝變寬、往右拖＝變窄；往下拖＝變高。
    onMove: (state) => applyResize(-state.dx, state.dy),
    onEnd: persist,
  });

  function arrowDelta(key: string, step: number) {
    switch (key) {
      case "ArrowLeft":
        return { dx: -step, dy: 0 };
      case "ArrowRight":
        return { dx: step, dy: 0 };
      case "ArrowUp":
        return { dx: 0, dy: -step };
      case "ArrowDown":
        return { dx: 0, dy: step };
      default:
        return null;
    }
  }

  /** 沒有指標裝置時（鍵盤）的移動替代方案：方向鍵 8px、Shift 微調 1px。 */
  function moveBy(dx: number, dy: number) {
    const box = rect.value;
    if (!box) {
      return;
    }
    const next = clampPanel(
      { x: box.x + dx, y: box.y + dy, width: panelWidth.value, height: panelHeight.value },
      bounds.value,
    );
    if (!next) {
      return;
    }
    posX.value = next.x;
    posY.value = next.y;
    persist();
  }

  /** 鍵盤的方向是「變大／變小」：右＝更寬、下＝更高。 */
  function resizeBy(dx: number, dy: number) {
    const box = rect.value;
    if (!box) {
      return;
    }
    resizeOrigin = { x: box.x, y: box.y, width: box.width, height: box.height };
    applyResize(dx, dy);
    persist();
  }

  /** 標題列的拖曳把手與收合鈕共用一個區塊，按到按鈕時不啟動拖曳。 */
  function onTitlePointerDown(event: PointerEvent) {
    if ((event.target as Element | null)?.closest("button")) {
      return;
    }
    move.onPointerDown(event);
  }

  function onTitleKeydown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggleCollapse();
      return;
    }
    const delta = arrowDelta(event.key, event.shiftKey ? 1 : 8);
    if (!delta) {
      return;
    }
    event.preventDefault();
    moveBy(delta.dx, delta.dy);
  }

  function onResizeKeydown(event: KeyboardEvent) {
    const delta = arrowDelta(event.key, event.shiftKey ? 1 : 8);
    if (!delta) {
      return;
    }
    event.preventDefault();
    resizeBy(delta.dx, delta.dy);
  }

  return {
    rect,
    panelStyle,
    moving: move.dragging,
    resizing: resize.dragging,
    onTitlePointerDown,
    onTitleKeydown,
    onResizePointerDown: resize.onPointerDown,
    onResizeKeydown,
  };
}
