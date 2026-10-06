<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import type { IconName } from "@/components/common/icons";
import ShortcutList from "./ShortcutList.vue";
import ToolsSettings from "./ToolsSettings.vue";
import * as api from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { ALL_COLUMNS, FONT_SIZE_MAX, FONT_SIZE_MIN, useSettingsStore } from "@/stores/settings";
import type { MotionPreference, ThemeMode } from "@/stores/settings";
import { useExplorerStore } from "@/stores/explorer";
import { useUiStore } from "@/stores/ui";
import { useToolEditorStore } from "@/stores/toolEditor";
import type { ColumnId } from "@/types/fs";
import { DEFAULT_ALIAS_TEMPLATE, folderDisplayName } from "@/utils/folders";
import {
  PANEL_MIN_WIDTH_CEILING,
  PANEL_MIN_WIDTH_FLOOR,
  PANEL_OPACITY_MAX,
  PANEL_OPACITY_MIN,
} from "@/utils/viewerPanel";
import { APP_VERSION } from "@/version";

type SectionId = "general" | "browse" | "tools" | "log" | "about";

const SECTIONS: { id: SectionId; label: string; icon: IconName }[] = [
  { id: "general", label: "一般", icon: "settings" },
  { id: "browse", label: "瀏覽", icon: "folderOpen" },
  { id: "tools", label: "外部工具", icon: "terminal" },
  { id: "log", label: "紀錄", icon: "history" },
  { id: "about", label: "關於", icon: "info" },
];

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "淺色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟隨系統" },
];

const MOTIONS: { value: MotionPreference; label: string }[] = [
  { value: "full", label: "完整" },
  { value: "system", label: "跟隨系統" },
  { value: "reduced", label: "減少" },
];

const settings = useSettingsStore();
const explorer = useExplorerStore();
const ui = useUiStore();
const toolEditor = useToolEditorStore();
const section = ref<SectionId>("general");

const logText = ref("");
const logPath = ref("");

/** 設定頁的即時預覽：固定用「別名＝工作、原始名稱＝Projects」示範格式效果。 */
const aliasPreview = computed(() =>
  folderDisplayName(
    { id: "preview", label: "Projects", kind: "folder", alias: "工作" },
    settings.aliasTemplate,
  ),
);

async function loadLog() {
  try {
    logText.value = await api.operationLog(300);
    logPath.value = await api.operationLogPath();
  } catch (cause) {
    ui.showNotice(normalizeBackendError(cause).message);
  }
}

watch(section, (value) => {
  if (value === "log") {
    void loadLog();
  }
});

/** 離開設定前先問過「外部工具」的未儲存草稿。 */
async function closeSettings() {
  if (await toolEditor.leaveSection()) {
    ui.settingsOpen = false;
  }
}

async function selectSection(id: SectionId) {
  if (id === section.value || !(await toolEditor.leaveSection())) {
    return;
  }
  section.value = id;
}

</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col bg-canvas">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-2">
      <button
        type="button"
        class="flex h-7 items-center gap-1 rounded-md pr-2.5 pl-1.5 text-sm text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        title="回到瀏覽 (Esc)"
        @click="closeSettings()"
      >
        <AppIcon name="chevronLeft" :size="14" />
        返回
      </button>
      <span class="text-base font-semibold text-ink">設定</span>
    </div>

    <div class="flex min-h-0 flex-1">
      <nav class="w-44 shrink-0 space-y-0.5 border-r border-line bg-rail p-2">
        <button
          v-for="item in SECTIONS"
          :key="item.id"
          type="button"
          class="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-base pressable"
          :class="
            section === item.id
              ? 'bg-accent-soft text-ink'
              : 'text-ink-muted hover:bg-surface-hover active:bg-pressed hover:text-ink'
          "
          @click="selectSection(item.id)"
        >
          <AppIcon :name="item.icon" :size="15" class="shrink-0 opacity-80" />
          {{ item.label }}
        </button>
      </nav>

      <div class="scroll-area min-h-0 flex-1 overflow-y-auto">
        <!--
          內容左靠左側分頁、只留固定邊距；上限 768px 讓行長保持可讀。
          其他頁用 min-h-full（內容比視窗高就讓外層捲動）；紀錄頁改用 h-full
          ＋外層 flex 把高度鎖住 —— min-height 只是下限，撐不住 log 內容，
          頁面會跟著長高、標題就會被捲走。高度等於「視窗高 − 標題／說明／路徑
          實際佔用」，由瀏覽器算，不寫死 calc。
          紀錄是資料不是散文，所以只有這一頁取消 768px 寬度上限。
        -->
        <div
          class="flex flex-col px-6 py-6"
          :class="section === 'log' ? 'h-full max-w-none' : 'min-h-full max-w-3xl'"
        >
          <!-- 一般 -->
          <div v-if="section === 'general'" class="divide-y divide-line">
            <section class="py-6 first:pt-0 last:pb-0">
              <h3 class="text-base font-semibold text-ink">外觀</h3>
              <div class="mt-2 flex gap-1 rounded-lg bg-surface-muted p-1">
                <button
                  v-for="theme in THEMES"
                  :key="theme.value"
                  type="button"
                  class="h-7 flex-1 rounded-md text-sm pressable"
                  :class="
                    settings.themeMode === theme.value
                      ? 'bg-surface text-ink shadow-sm'
                      : 'text-ink-muted hover:text-ink'
                  "
                  @click="settings.themeMode = theme.value"
                >
                  {{ theme.label }}
                </button>
              </div>
            </section>

            <section class="py-6 first:pt-0 last:pb-0">
              <div class="flex items-baseline justify-between">
                <h3 class="text-base font-semibold text-ink">字型</h3>
                <button
                  type="button"
                  class="rounded px-1.5 py-1 text-xs text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
                  @click="settings.resetFont()"
                >
                  重設字型與字級
                </button>
              </div>
              <div class="mt-2 space-y-2">
                <label class="flex items-center gap-3">
                  <span class="w-10 shrink-0 text-sm text-ink-muted">字型</span>
                  <input
                    type="text"
                    class="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-base text-ink transition-colors placeholder:text-ink-faint focus:border-accent focus:outline-none"
                    placeholder="留空＝系統預設字型"
                    spellcheck="false"
                    autocomplete="off"
                    :value="settings.fontFamily"
                    @input="settings.fontFamily = ($event.target as HTMLInputElement).value"
                  />
                </label>
                <div class="flex items-center gap-3">
                  <span class="w-10 shrink-0 text-sm text-ink-muted">字級</span>
                  <input
                    type="range"
                    class="h-8 min-w-0 flex-1 accent-[var(--color-accent)]"
                    :min="FONT_SIZE_MIN"
                    :max="FONT_SIZE_MAX"
                    step="1"
                    :value="settings.fontSize"
                    @input="settings.setFontSize(Number(($event.target as HTMLInputElement).value))"
                  />
                  <span class="w-10 shrink-0 text-right text-sm tabular-nums text-ink-muted">
                    {{ settings.fontSize }}px
                  </span>
                </div>
              </div>
              <p class="mt-2 text-xs leading-relaxed text-ink-faint">
                字型可填系統已安裝的任何名稱（例如 Microsoft JhengHei UI）；留空則使用系統預設字型。
                字級只調整文字，版面與欄寬維持不變。
              </p>
            </section>

            <section class="py-6 first:pt-0 last:pb-0">
              <div class="flex items-baseline justify-between">
                <h3 class="text-base font-semibold text-ink">資料夾顯示名稱</h3>
                <button
                  type="button"
                  class="rounded px-1.5 py-1 text-xs text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
                  @click="settings.resetAliasTemplate()"
                >
                  重設
                </button>
              </div>
              <p class="mt-1 text-sm leading-relaxed text-ink-muted">
                左側清單的資料夾設定別名後，用這個格式顯示。可用變數：
                <code class="rounded bg-surface-muted px-1 text-xs">$aliasName</code>（別名）、
                <code class="rounded bg-surface-muted px-1 text-xs">$RealFolderName</code>（原始資料夾名稱）。
                只有第一層的真實資料夾（含虛擬目錄下的第一層）能設定別名。
              </p>
              <input
                type="text"
                class="mt-2 h-8 w-full rounded-md border border-line bg-surface px-2.5 font-mono text-base text-ink transition-colors placeholder:text-ink-faint focus:border-accent focus:outline-none"
                :placeholder="DEFAULT_ALIAS_TEMPLATE"
                spellcheck="false"
                autocomplete="off"
                :value="settings.aliasTemplate"
                @input="settings.aliasTemplate = ($event.target as HTMLInputElement).value"
              />
              <p class="mt-2 text-xs text-ink-faint">
                預覽：<span class="text-ink-muted">{{ aliasPreview }}</span>
                （留空＝使用預設格式）
              </p>
            </section>

            <section class="py-6 first:pt-0 last:pb-0">
              <h3 class="text-base font-semibold text-ink">動態效果</h3>
              <div class="mt-2 flex gap-1 rounded-lg bg-surface-muted p-1">
                <button
                  v-for="motion in MOTIONS"
                  :key="motion.value"
                  type="button"
                  class="h-7 flex-1 rounded-md text-sm pressable"
                  :class="
                    settings.motion === motion.value
                      ? 'bg-surface text-ink shadow-sm'
                      : 'text-ink-muted hover:text-ink'
                  "
                  @click="settings.motion = motion.value"
                >
                  {{ motion.label }}
                </button>
              </div>
              <p class="mt-2 text-xs leading-relaxed text-ink-faint">
                減少動態時，位移一律改為短暫的淡入淡出，不做彈跳；視窗材質也會依系統的
                「減少透明度」與「提高對比」偏好自動調整。
              </p>
            </section>
          </div>

          <!-- 瀏覽 -->
          <div v-else-if="section === 'browse'" class="divide-y divide-line">
            <section class="space-y-2 py-6 first:pt-0 last:pb-0">
              <label class="flex items-center justify-between py-1">
                <span class="text-base text-ink">顯示隱藏項目</span>
                <input
                  type="checkbox"
                  class="size-4 accent-[var(--color-accent)]"
                  :checked="settings.showHidden"
                  @change="settings.showHidden = ($event.target as HTMLInputElement).checked"
                />
              </label>
              <label class="flex items-center justify-between py-1">
                <span class="text-base text-ink">啟動時還原上次的分頁與窗格</span>
                <input
                  type="checkbox"
                  class="size-4 accent-[var(--color-accent)]"
                  :checked="settings.restoreSession"
                  @change="settings.restoreSession = ($event.target as HTMLInputElement).checked"
                />
              </label>
              <label class="flex items-center justify-between py-1">
                <span class="text-base text-ink">清單自動更新</span>
                <input
                  type="checkbox"
                  class="size-4 accent-[var(--color-accent)]"
                  :checked="settings.autoRefresh"
                  @change="settings.autoRefresh = ($event.target as HTMLInputElement).checked"
                />
              </label>
            </section>

            <section class="py-6 first:pt-0 last:pb-0">
              <div class="flex items-baseline justify-between">
                <h3 class="text-base font-semibold text-ink">顯示欄位</h3>
                <button
                  type="button"
                  class="rounded px-1.5 py-1 text-xs text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
                  @click="explorer.resetAllColumnWidths()"
                >
                  重設所有欄寬
                </button>
              </div>
              <p class="mt-1 text-sm leading-relaxed text-ink-muted">
                點欄位標題排序，拖曳標題邊緣調整寬度，雙擊邊緣回到預設。
              </p>
              <div class="mt-2 flex flex-wrap gap-1">
                <button
                  v-for="column in ALL_COLUMNS"
                  :key="column.id"
                  type="button"
                  class="h-7 rounded-md border px-2.5 text-sm pressable"
                  :class="
                    settings.columns.includes(column.id)
                      ? 'border-accent/40 bg-accent-soft text-ink'
                      : 'border-line text-ink-muted hover:bg-surface-hover active:bg-pressed hover:text-ink'
                  "
                  @click="settings.toggleColumn(column.id as ColumnId)"
                >
                  {{ column.label }}
                </button>
              </div>
            </section>

            <section class="py-6 first:pt-0 last:pb-0">
              <h3 class="text-base font-semibold text-ink">檢視器</h3>
              <p class="mt-1 text-sm leading-relaxed text-ink-muted">
                檢視器右上角的浮動面板（Markdown 的「目錄索引」與各文字檢視器的「搜尋」）。
                最小寬度是拖曳下限，窗格比「最小寬度 + 兩側留白」還窄時面板會自動隱藏；
                不透明度越低，面板底下的內文越明顯。兩個面板共用這兩項設定。
              </p>
              <div class="mt-2 space-y-2">
                <div class="flex items-center gap-3">
                  <span class="w-16 shrink-0 text-sm text-ink-muted">最小寬度</span>
                  <input
                    type="range"
                    class="h-8 min-w-0 flex-1 accent-[var(--color-accent)]"
                    :min="PANEL_MIN_WIDTH_FLOOR"
                    :max="PANEL_MIN_WIDTH_CEILING"
                    step="10"
                    :value="settings.viewerPanelMinWidth"
                    @input="
                      settings.setViewerPanelMinWidth(
                        Number(($event.target as HTMLInputElement).value),
                      )
                    "
                  />
                  <span class="w-14 shrink-0 text-right text-sm tabular-nums text-ink-muted">
                    {{ settings.viewerPanelMinWidth }}px
                  </span>
                </div>
                <div class="flex items-center gap-3">
                  <span class="w-16 shrink-0 text-sm text-ink-muted">不透明度</span>
                  <input
                    type="range"
                    class="h-8 min-w-0 flex-1 accent-[var(--color-accent)]"
                    :min="PANEL_OPACITY_MIN"
                    :max="PANEL_OPACITY_MAX"
                    step="5"
                    :value="settings.viewerPanelOpacity"
                    @input="
                      settings.setViewerPanelOpacity(
                        Number(($event.target as HTMLInputElement).value),
                      )
                    "
                  />
                  <span class="w-14 shrink-0 text-right text-sm tabular-nums text-ink-muted">
                    {{ settings.viewerPanelOpacity }}%
                  </span>
                </div>
              </div>
            </section>
          </div>

          <!-- 外部工具 -->
          <ToolsSettings v-else-if="section === 'tools'" />

          <!-- 紀錄：撐滿可用高度（高度交給 flex 算，不必自己減一整串固定高度） -->
          <div v-else-if="section === 'log'" class="flex min-h-0 flex-1 flex-col gap-3">
            <div class="flex items-center justify-between">
              <h3 class="text-base font-semibold text-ink">檔案操作紀錄</h3>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="h-7 rounded-md border border-line px-2.5 text-sm text-ink pressable hover:bg-surface-hover active:bg-pressed"
                  @click="loadLog()"
                >
                  重新整理
                </button>
                <button
                  type="button"
                  class="h-7 rounded-md border border-line px-2.5 text-sm text-ink pressable hover:bg-surface-hover active:bg-pressed"
                  :disabled="!logPath"
                  @click="explorer.revealTarget(logPath)"
                >
                  開啟紀錄檔
                </button>
              </div>
            </div>

            <p class="text-sm leading-relaxed text-ink-muted">
              剪下、複製、貼上與刪除的每一次操作、結果與錯誤都寫在這裡。
              紀錄只存在本機，不會上傳；超過 512 KB 會自動輪替成舊檔。
            </p>

            <pre
              class="scroll-area min-h-0 w-full flex-1 overflow-y-auto rounded-xl border border-line bg-surface pt-3 pl-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-ink-muted"
            >{{ logText || "（還沒有紀錄）" }}</pre>

            <p v-if="logPath" class="truncate text-xs text-ink-faint" :title="logPath">
              {{ logPath }}
            </p>
          </div>

          <!-- 關於 -->
          <div v-else class="space-y-4">
            <div>
              <h3 class="text-lg font-semibold text-ink">PuffFile</h3>
              <p class="mt-1 text-sm text-ink-muted">
                極致輕量的工作資料夾快速通道 · Tauri 2 + Vue 3.5 + Rust
              </p>
            </div>
            <p class="text-sm leading-relaxed text-ink-muted">
              PuffFile 不是要取代檔案總管，而是解決「每天不斷反覆進出同幾個資料夾」。
              左側「我的資料夾」可以用虛擬目錄分組、替第一層的真實資料夾設定別名；
              分頁與左右／上下分割讓兩個位置並排工作。
            </p>
            <p class="text-sm leading-relaxed text-ink-muted">
              剪下、複製、貼上、刪除、重新命名與建立新資料夾／新檔案都直接交給 Windows 的檔案操作機制，
              所以衝突處理、進度、取消與資源回收筒的行為都與檔案總管一致，剪貼簿也雙向互通。
              資料夾內容的變更由系統通知即時反映到清單（可在設定關閉），不必手動重新整理；
              重新命名是清單中的就地編輯（F2），一般右鍵選單只留常用動作，
              按住 Shift 再右鍵才會出現剪下、複製、貼上、刪除與重新命名。
            </p>
            <dl class="space-y-1 text-sm text-ink-muted">
              <div class="flex gap-3">
                <dt class="w-24 shrink-0 text-ink-faint">版號</dt>
                <dd class="tabular-nums">{{ APP_VERSION }}</dd>
              </div>
              <div class="flex gap-3">
                <dt class="w-24 shrink-0 text-ink-faint">外部工具</dt>
                <dd>{{ settings.tools.length }} 個</dd>
              </div>
              <div class="flex gap-3">
                <dt class="w-24 shrink-0 text-ink-faint">設定存放</dt>
                <dd>本機 localStorage，不會上傳</dd>
              </div>
              <div class="flex gap-3">
                <dt class="w-24 shrink-0 text-ink-faint">操作紀錄</dt>
                <dd class="min-w-0 break-all">
                  %LOCALAPPDATA%\PuffFile\logs\file-ops.log（超過 512 KB 自動輪替）
                </dd>
              </div>
            </dl>

            <ShortcutList />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
