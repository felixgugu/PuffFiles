import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { STORAGE_KEYS, readJson, writeJson } from "@/services/storage";
import { useExplorerStore } from "@/stores/explorer";
import { useSettingsStore } from "@/stores/settings";
import type { PaneId, SplitDirection, TabState } from "@/types/fs";

interface SessionPane {
  path: string;
}

interface SessionTab {
  panes: SessionPane[];
  direction: SplitDirection;
  ratio: number;
  activeIndex: number;
}

interface SessionSnapshot {
  tabs: SessionTab[];
  activeIndex: number;
}

const EMPTY_SESSION: SessionSnapshot = { tabs: [], activeIndex: 0 };

/** 版面比例的安全範圍：兩邊都留得住內容。 */
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;

/**
 * 分頁與版面：決定「有幾個分頁、每個分頁切成幾個窗格」。
 *
 * 窗格本身的瀏覽狀態住在 `explorer` store；這裡只持有 PaneId 與版面資訊。
 */
export const useTabsStore = defineStore("tabs", () => {
  const explorer = useExplorerStore();
  const settings = useSettingsStore();

  const tabs = ref<TabState[]>([]);
  const activeTabId = ref<string>("");
  let sequence = 0;

  const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null);
  const activePaneId = computed(() => activeTab.value?.activePaneId ?? "");
  const isSplit = computed(() => (activeTab.value?.paneIds.length ?? 0) > 1);

  function createTabState(paneIds: PaneId[], direction: SplitDirection, ratio: number): TabState {
    return {
      id: `tab-${++sequence}`,
      paneIds,
      direction,
      activePaneId: paneIds[0],
      ratio,
    };
  }

  /** 建立新分頁；`path` 省略時沿用目前焦點窗格的路徑。 */
  function newTab(path?: string): TabState {
    const fallback = path ?? explorer.meta(activePaneId.value)?.currentPath ?? "";
    const paneId = explorer.createPane(fallback);
    const tab = createTabState([paneId], "row", 0.5);
    tabs.value = [...tabs.value, tab];
    activeTabId.value = tab.id;
    if (fallback) {
      void explorer.load(paneId, fallback);
    }
    return tab;
  }

  function closeTab(id: string) {
    const tab = tabs.value.find((item) => item.id === id);
    if (!tab) {
      return;
    }
    for (const paneId of tab.paneIds) {
      explorer.destroyPane(paneId);
    }
    const index = tabs.value.findIndex((item) => item.id === id);
    const next = tabs.value.filter((item) => item.id !== id);
    tabs.value = next;

    if (next.length === 0) {
      newTab();
      return;
    }
    if (activeTabId.value === id) {
      activeTabId.value = next[Math.min(index, next.length - 1)].id;
    }
  }

  function activateTab(id: string) {
    if (tabs.value.some((tab) => tab.id === id)) {
      activeTabId.value = id;
    }
  }

  function activateTabAt(index: number) {
    const target = tabs.value[index];
    if (target) {
      activeTabId.value = target.id;
    }
  }

  function cycleTab(delta: number) {
    const index = tabs.value.findIndex((tab) => tab.id === activeTabId.value);
    if (index === -1 || tabs.value.length < 2) {
      return;
    }
    const next = (index + delta + tabs.value.length) % tabs.value.length;
    activeTabId.value = tabs.value[next].id;
  }

  function moveTab(from: number, to: number) {
    const next = [...tabs.value];
    const [moved] = next.splice(from, 1);
    if (!moved) {
      return;
    }
    next.splice(to, 0, moved);
    tabs.value = next;
  }

  function setActivePane(paneId: PaneId) {
    const tab = activeTab.value;
    if (tab?.paneIds.includes(paneId)) {
      tab.activePaneId = paneId;
    }
  }

  /** 分割：已有兩個窗格時只切換方向，不新增。 */
  function split(direction: SplitDirection) {
    const tab = activeTab.value;
    if (!tab) {
      return;
    }
    if (tab.paneIds.length > 1) {
      tab.direction = direction;
      return;
    }
    const source = explorer.meta(tab.activePaneId)?.currentPath ?? "";
    const paneId = explorer.createPane(source);
    tab.paneIds = [...tab.paneIds, paneId];
    tab.direction = direction;
    tab.activePaneId = paneId;
    if (source) {
      void explorer.load(paneId, source);
    }
  }

  /** 收起分割：關閉非焦點的窗格，保留使用者正在操作的那一個。 */
  function unsplit() {
    const tab = activeTab.value;
    if (!tab || tab.paneIds.length < 2) {
      return;
    }
    const keep = tab.activePaneId;
    for (const paneId of tab.paneIds.filter((id) => id !== keep)) {
      explorer.destroyPane(paneId);
    }
    tab.paneIds = [keep];
  }

  function closePane(paneId: PaneId) {
    const tab = activeTab.value;
    if (!tab) {
      return;
    }
    if (tab.paneIds.length < 2) {
      closeTab(tab.id);
      return;
    }
    explorer.destroyPane(paneId);
    tab.paneIds = tab.paneIds.filter((id) => id !== paneId);
    if (tab.activePaneId === paneId) {
      tab.activePaneId = tab.paneIds[0];
    }
  }

  /** `clamp = false` 用於拖曳中：允許短暫越界，由呼叫端做橡皮筋與回彈。 */
  function setRatio(id: string, ratio: number, clamp = true) {
    const tab = tabs.value.find((item) => item.id === id);
    if (!tab) {
      return;
    }
    if (clamp) {
      tab.ratio = Math.min(Math.max(ratio, MIN_RATIO), MAX_RATIO);
    } else {
      tab.ratio = Math.min(Math.max(ratio, 0.02), 0.98);
    }
  }

  function otherPaneId(tab: TabState): PaneId | null {
    return tab.paneIds.find((id) => id !== tab.activePaneId) ?? null;
  }

  function snapshot(): SessionSnapshot {
    return {
      tabs: tabs.value.map((tab) => ({
        panes: tab.paneIds.map((paneId) => ({
          path: explorer.meta(paneId)?.currentPath ?? "",
        })),
        direction: tab.direction,
        ratio: tab.ratio,
        activeIndex: Math.max(tab.paneIds.indexOf(tab.activePaneId), 0),
      })),
      activeIndex: Math.max(
        tabs.value.findIndex((tab) => tab.id === activeTabId.value),
        0,
      ),
    };
  }

  function restore(session: SessionSnapshot) {
    for (const tab of tabs.value) {
      for (const paneId of tab.paneIds) {
        explorer.destroyPane(paneId);
      }
    }
    tabs.value = [];

    for (const saved of session.tabs) {
      const paneIds = saved.panes.map((pane) => explorer.createPane(pane.path));
      if (paneIds.length === 0) {
        continue;
      }
      const tab = createTabState(paneIds, saved.direction, saved.ratio);
      tab.activePaneId = paneIds[Math.min(saved.activeIndex, paneIds.length - 1)];
      tabs.value = [...tabs.value, tab];
    }

    const target = tabs.value[session.activeIndex];
    activeTabId.value = target?.id ?? tabs.value[0]?.id ?? "";
    void reloadAll();
  }

  /** 把每個窗格的路徑重新載入（啟動還原、或重新整理全部）。 */
  async function reloadAll() {
    await Promise.all(
      tabs.value.flatMap((tab) =>
        tab.paneIds.map((paneId) => {
          const path = explorer.meta(paneId)?.currentPath;
          return path ? explorer.load(paneId, path) : Promise.resolve();
        }),
      ),
    );
  }

  /** 開機：還原上次工作階段，或開一個新分頁。 */
  function bootstrap(startLocation: string | null) {
    const session = readJson<SessionSnapshot>(
      STORAGE_KEYS.session,
      EMPTY_SESSION,
      (value) => Array.isArray((value as SessionSnapshot)?.tabs),
    );

    if (settings.restoreSession && session.tabs.length > 0) {
      restore(session);
      return;
    }
    newTab(startLocation ?? "");
  }

  watch(
    [tabs, activeTabId],
    () => {
      if (settings.restoreSession) {
        writeJson(STORAGE_KEYS.session, snapshot());
      }
    },
    { deep: true },
  );

  return {
    tabs,
    activeTabId,
    activeTab,
    activePaneId,
    isSplit,
    newTab,
    closeTab,
    activateTab,
    activateTabAt,
    cycleTab,
    moveTab,
    setActivePane,
    split,
    unsplit,
    closePane,
    setRatio,
    otherPaneId,
    bootstrap,
    reloadAll,
  };
});

// setup store 內有非響應式快取（項目陣列、AbortController、子節點快取），
// 熱更新無法安全接手，整頁重載才能保證狀態一致；工作階段會從 localStorage 還原。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
