import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useClipboardStore } from "@/stores/clipboard";
import { normalizeKey } from "@/utils/path";
import { planDrop, type DragEffect, type DragModifier } from "@/utils/dragDrop";
import type { PaneId } from "@/types/fs";

/** 拖曳中的一項（只需要顯示殘影與判斷資料夾用得到的資訊）。 */
export interface DragSource {
  path: string;
  isDir: boolean;
}

/** 放置目標的種類：資料夾列、窗格空白處、左側資料夾樹。 */
export type DropKind = "folder" | "pane" | "tree";

export interface DropHover {
  kind: DropKind;
  path: string;
}

interface DragSession {
  sources: DragSource[];
  sourcePaneId: PaneId;
  /** 游標位置（client 座標），拖曳殘影跟著它跑。 */
  point: { x: number; y: number };
  modifiers: DragModifier;
  hover: DropHover | null;
}

/**
 * 檔案拖曳的狀態（見 AGENTS.md「檔案拖曳移動」）。
 *
 * 手勢與命中判定在 `composables/useFileDrag.ts`，這裡只放跨元件共用的狀態：
 * 拖曳中的項目、游標位置、目前懸停的放置目標，以及放開後要執行的動作。
 * 真正的搬移／複製交給 clipboard store（`transferPaths`），維持檔案操作只有一條路徑。
 */
export const useDragStore = defineStore("drag", () => {
  const clipboard = useClipboardStore();

  const session = ref<DragSession | null>(null);
  /** 這次手勢被取消（Esc／視窗失焦）：在指標放開前不再重新開始拖曳。 */
  const cancelled = ref(false);

  const active = computed(() => session.value !== null);
  const sources = computed<DragSource[]>(() => session.value?.sources ?? []);
  const point = computed(() => session.value?.point ?? { x: 0, y: 0 });
  const hover = computed<DropHover | null>(() => session.value?.hover ?? null);
  const modifiers = computed<DragModifier>(() => session.value?.modifiers ?? "none");

  /** 這次放開會做什麼；沒有懸停目標時回 `none`。 */
  const plan = computed(() => {
    const state = session.value;
    if (!state?.hover) {
      return null;
    }
    return planDrop(
      state.sources.map((source) => source.path),
      state.hover.path,
      state.modifiers,
    );
  });

  const effect = computed<DragEffect>(() => plan.value?.effect ?? "none");
  /** 不動作的原因（拖曳殘影用）。 */
  const rejectReason = computed(() => (plan.value?.effect === "none" ? plan.value.reason ?? "" : ""));
  /** 不動作的分類（游標用）：同一資料夾仍是一般箭頭。 */
  const reject = computed(() => (effect.value === "none" ? plan.value?.reject ?? null : null));

  /** 可以放開的目標種類；`null`＝現在沒有合法目標（用來畫高亮，不畫無效目標）。 */
  const hoverKind = computed<DropKind | null>(() =>
    session.value?.hover && effect.value !== "none" ? session.value.hover.kind : null,
  );
  /** 可以放開的目標路徑（正規化鍵），提供列與樹節點比對高亮。 */
  const hoverKey = computed(() =>
    session.value?.hover && effect.value !== "none" ? normalizeKey(session.value.hover.path) : "",
  );

  function begin(list: DragSource[], sourcePaneId: PaneId) {
    if (!list.length) {
      return;
    }
    cancelled.value = false;
    session.value = {
      sources: list,
      sourcePaneId,
      point: { x: 0, y: 0 },
      modifiers: "none",
      hover: null,
    };
  }

  function moveTo(x: number, y: number) {
    if (session.value) {
      session.value.point = { x, y };
    }
  }

  function setModifiers(next: DragModifier) {
    if (session.value && session.value.modifiers !== next) {
      session.value.modifiers = next;
    }
  }

  /** 更新目前懸停的放置目標；`kind` 省略或路徑空白＝離開所有目標。 */
  function hoverOn(kind: DropKind | null, path = "") {
    const state = session.value;
    if (!state) {
      return;
    }
    if (!kind || !path) {
      if (state.hover) {
        state.hover = null;
      }
      return;
    }
    if (state.hover?.kind === kind && state.hover.path === path) {
      return;
    }
    state.hover = { kind, path };
  }

  function cancel() {
    cancelled.value = true;
    session.value = null;
  }

  /** 新的手勢開始（指標按下）：解除上一次的取消狀態。 */
  function resetCancel() {
    cancelled.value = false;
  }

  /**
   * 放開滑鼠：先收掉殘影再執行檔案操作。
   *
   * 目標不合法（同一個資料夾、拖進自己、沒有懸停）時什麼都不做；其餘交給
   * `clipboard.transferPaths`，衝突與進度仍由 Windows 的對話框呈現。
   */
  async function drop(): Promise<boolean> {
    const state = session.value;
    if (!state) {
      return false;
    }
    const target = state.hover;
    const decision = target
      ? planDrop(
          state.sources.map((source) => source.path),
          target.path,
          state.modifiers,
        )
      : null;
    session.value = null;
    if (!target || !decision || decision.effect === "none") {
      return false;
    }
    return clipboard.transferPaths(
      state.sources.map((source) => source.path),
      target.path,
      decision.effect,
    );
  }

  return {
    active,
    cancelled,
    sources,
    point,
    hover,
    modifiers,
    effect,
    rejectReason,
    reject,
    hoverKind,
    hoverKey,
    begin,
    moveTo,
    setModifiers,
    hoverOn,
    cancel,
    resetCancel,
    drop,
  };
});
