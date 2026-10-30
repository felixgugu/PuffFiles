import { onScopeDispose } from "vue";
import { useDragStore, type DragSource, type DropKind } from "@/stores/drag";
import type { DragModifier } from "@/utils/dragDrop";
import type { PaneId } from "@/types/fs";

interface ModifierEvent {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** 修飾鍵 → 拖曳模式（Ctrl＝複製、Shift＝移動）。 */
function modifierOf(event: ModifierEvent): DragModifier {
  if (event.ctrlKey || event.metaKey) {
    return "copy";
  }
  return event.shiftKey ? "move" : "none";
}

/** 放置目標所在的元素：`data-drop-path`／`data-drop-kind` 由清單、列與資料夾樹提供。 */
function dropZoneAt(x: number, y: number): { kind: DropKind; path: string } | null {
  const element = document.elementFromPoint(x, y);
  const zone =
    element instanceof Element ? element.closest<HTMLElement>("[data-drop-path]") : null;
  const path = zone?.dataset.dropPath?.trim();
  if (!path) {
    return null;
  }
  const kind = (zone?.dataset.dropKind as DropKind | undefined) ?? "pane";
  return { kind, path };
}

/**
 * 檔案拖曳的手勢（見 AGENTS.md「檔案拖曳移動」）。
 *
 * 手勢本身由 `FileListView` 的指標事件驅動（它已經有一整套選取與自動捲動），這裡只負責
 * 「命中哪個放置目標、游標長什麼樣、Esc／視窗失焦取消」這些與清單無關的部分。
 * 狀態住在 `stores/drag.ts`，殘影是 `DragGhost.vue`。
 */
export function useFileDrag() {
  const drag = useDragStore();
  let attached = false;

  /** 游標：複製＝`copy`、無效目標＝`not-allowed`、其餘維持一般箭頭（與檔案總管一致）。 */
  function syncCursor() {
    if (!drag.active) {
      document.body.style.cursor = "";
      return;
    }
    if (drag.effect === "copy") {
      document.body.style.cursor = "copy";
    } else if (drag.reject === "inside-self") {
      document.body.style.cursor = "not-allowed";
    } else {
      document.body.style.cursor = "default";
    }
  }

  /** 重新判定游標底下的放置目標；每次移動都跑，捲動或修飾鍵改變也一樣。 */
  function refresh(x: number, y: number, event?: ModifierEvent) {
    if (event) {
      drag.setModifiers(modifierOf(event));
    }
    const zone = dropZoneAt(x, y);
    drag.hoverOn(zone?.kind ?? null, zone?.path ?? "");
    syncCursor();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      // 拖曳中按 Esc＝取消（檔案總管也是）。用 capture 攔下來，避免同時清掉選取。
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    drag.setModifiers(modifierOf(event));
    syncCursor();
  }

  function onKeyUp(event: KeyboardEvent) {
    drag.setModifiers(modifierOf(event));
    syncCursor();
  }

  /** 視窗失焦（Alt+Tab、點到別的程式）時取消，免得回來還拖著一份殘影。 */
  function onWindowBlur() {
    cancel();
  }

  function attach() {
    if (attached) {
      return;
    }
    attached = true;
    /*
     * `data-file-drag` 讓 main.css 把整棵樹的游標交還給 body：列與樹節點各自有
     * cursor-default／cursor-grab，不蓋掉的話拖曳中看不到複製／禁止的游標。
     */
    document.body.dataset.fileDrag = "";
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onWindowBlur);
  }

  function detach() {
    if (!attached) {
      return;
    }
    attached = false;
    delete document.body.dataset.fileDrag;
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onWindowBlur);
    document.body.style.cursor = "";
  }

  function begin(sources: DragSource[], paneId: PaneId) {
    if (!sources.length) {
      return;
    }
    drag.begin(sources, paneId);
    attach();
  }

  function move(x: number, y: number, event?: ModifierEvent) {
    if (drag.active) {
      refresh(x, y, event);
    }
  }

  /** 放開：先收掉殘影與監聽，再執行檔案操作（非同步，呼叫端不必等）。 */
  async function finish(): Promise<boolean> {
    if (!drag.active) {
      return false;
    }
    detach();
    return drag.drop();
  }

  function cancel() {
    detach();
    drag.cancel();
  }

  // 來源窗格在拖曳途中被卸載（切分頁、關窗格）時，監聽與游標不能留下來。
  onScopeDispose(() => {
    if (!attached) {
      return;
    }
    detach();
    drag.cancel();
  });

  return { begin, move, finish, cancel };
}
