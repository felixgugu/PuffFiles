<script setup lang="ts">
import { ref, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import type { IconName } from "@/components/common/icons";
import ToolsSettings from "./ToolsSettings.vue";
import * as api from "@/services/api";
import { normalizeBackendError } from "@/services/errors";
import { ALL_COLUMNS, useSettingsStore } from "@/stores/settings";
import type { MotionPreference, ThemeMode } from "@/stores/settings";
import { useExplorerStore } from "@/stores/explorer";
import { useUiStore } from "@/stores/ui";
import type { ColumnId } from "@/types/fs";

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
const section = ref<SectionId>("general");

const logText = ref("");
const logPath = ref("");

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

</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col bg-canvas">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-2">
      <button
        type="button"
        class="flex h-7 items-center gap-1 rounded-md pr-2.5 pl-1.5 text-[12px] text-ink-muted transition-colors duration-75 hover:bg-surface-hover hover:text-ink"
        title="回到瀏覽 (Esc)"
        @click="ui.settingsOpen = false"
      >
        <AppIcon name="chevronLeft" :size="14" />
        返回
      </button>
      <span class="text-[13px] font-semibold text-ink">設定</span>
    </div>

    <div class="flex min-h-0 flex-1">
      <nav class="w-44 shrink-0 space-y-0.5 border-r border-line bg-rail p-2">
        <button
          v-for="item in SECTIONS"
          :key="item.id"
          type="button"
          class="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors duration-75"
          :class="
            section === item.id
              ? 'bg-accent-soft text-ink'
              : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
          "
          @click="section = item.id"
        >
          <AppIcon :name="item.icon" :size="15" class="shrink-0 opacity-80" />
          {{ item.label }}
        </button>
      </nav>

      <div class="scroll-area min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto max-w-2xl px-6 py-6">
          <!-- 一般 -->
          <div v-if="section === 'general'" class="space-y-6">
            <section>
              <h3 class="text-[13px] font-semibold text-ink">外觀</h3>
              <div class="mt-2 flex gap-1 rounded-lg bg-surface-muted p-1">
                <button
                  v-for="theme in THEMES"
                  :key="theme.value"
                  type="button"
                  class="h-7 flex-1 rounded-md text-[12px] transition-colors duration-100"
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

            <section>
              <h3 class="text-[13px] font-semibold text-ink">動態效果</h3>
              <div class="mt-2 flex gap-1 rounded-lg bg-surface-muted p-1">
                <button
                  v-for="motion in MOTIONS"
                  :key="motion.value"
                  type="button"
                  class="h-7 flex-1 rounded-md text-[12px] transition-colors duration-100"
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
              <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
                減少動態時，位移一律改為短暫的淡入淡出，不做彈跳；視窗材質也會依系統的
                「減少透明度」與「提高對比」偏好自動調整。
              </p>
            </section>
          </div>

          <!-- 瀏覽 -->
          <div v-else-if="section === 'browse'" class="space-y-6">
            <section class="space-y-2">
              <label class="flex items-center justify-between py-1">
                <span class="text-[13px] text-ink">顯示隱藏項目</span>
                <input
                  type="checkbox"
                  class="size-4 accent-[var(--color-accent)]"
                  :checked="settings.showHidden"
                  @change="settings.showHidden = ($event.target as HTMLInputElement).checked"
                />
              </label>
              <label class="flex items-center justify-between py-1">
                <span class="text-[13px] text-ink">啟動時還原上次的分頁與窗格</span>
                <input
                  type="checkbox"
                  class="size-4 accent-[var(--color-accent)]"
                  :checked="settings.restoreSession"
                  @change="settings.restoreSession = ($event.target as HTMLInputElement).checked"
                />
              </label>
              <label class="flex items-center justify-between py-1">
                <span class="text-[13px] text-ink">清單自動更新</span>
                <input
                  type="checkbox"
                  class="size-4 accent-[var(--color-accent)]"
                  :checked="settings.autoRefresh"
                  @change="settings.autoRefresh = ($event.target as HTMLInputElement).checked"
                />
              </label>
            </section>

            <section>
              <h3 class="text-[13px] font-semibold text-ink">顯示欄位</h3>
              <p class="mt-1 text-[12px] leading-relaxed text-ink-muted">
                點欄位標題排序，拖曳標題邊緣調整寬度，雙擊邊緣回到預設。
              </p>
              <div class="mt-2 flex flex-wrap gap-1">
                <button
                  v-for="column in ALL_COLUMNS"
                  :key="column.id"
                  type="button"
                  class="h-7 rounded-md border px-2.5 text-[12px] transition-colors duration-75"
                  :class="
                    settings.columns.includes(column.id)
                      ? 'border-accent/40 bg-accent-soft text-ink'
                      : 'border-line text-ink-muted hover:bg-surface-hover hover:text-ink'
                  "
                  @click="settings.toggleColumn(column.id as ColumnId)"
                >
                  {{ column.label }}
                </button>
              </div>
              <button
                type="button"
                class="mt-2 rounded px-1.5 py-1 text-[11px] text-ink-muted transition-colors duration-75 hover:bg-surface-hover hover:text-ink"
                @click="explorer.resetAllColumnWidths()"
              >
                重設所有欄寬
              </button>
            </section>
          </div>

          <!-- 外部工具 -->
          <ToolsSettings v-else-if="section === 'tools'" />

          <!-- 紀錄 -->
          <div v-else-if="section === 'log'" class="space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="text-[13px] font-semibold text-ink">檔案操作紀錄</h3>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="h-7 rounded-md border border-line px-2.5 text-[12px] text-ink transition-colors duration-75 hover:bg-surface-hover"
                  @click="loadLog()"
                >
                  重新整理
                </button>
                <button
                  type="button"
                  class="h-7 rounded-md border border-line px-2.5 text-[12px] text-ink transition-colors duration-75 hover:bg-surface-hover"
                  :disabled="!logPath"
                  @click="explorer.revealTarget(logPath)"
                >
                  開啟紀錄檔
                </button>
              </div>
            </div>

            <p class="text-[12px] leading-relaxed text-ink-muted">
              剪下、複製、貼上與刪除的每一次操作、結果與錯誤都寫在這裡。
              紀錄只存在本機，不會上傳；超過 512 KB 會自動輪替成舊檔。
            </p>

            <pre
              class="scroll-area max-h-[52vh] overflow-auto rounded-xl border border-line bg-surface p-3 font-mono text-[11px] leading-relaxed whitespace-pre text-ink-muted"
            >{{ logText || "（還沒有紀錄）" }}</pre>

            <p v-if="logPath" class="text-[11px] break-all text-ink-faint">{{ logPath }}</p>
          </div>

          <!-- 關於 -->
          <div v-else class="space-y-4">
            <div>
              <h3 class="text-[15px] font-semibold text-ink">PuffFile</h3>
              <p class="mt-1 text-[12px] text-ink-muted">
                極致輕量的工作資料夾快速通道 · Tauri 2 + Vue 3 + Rust
              </p>
            </div>
            <p class="text-[12px] leading-relaxed text-ink-muted">
              PuffFile 專注在「快速回到常用工作資料夾」。剪下、複製、貼上與刪除都直接交給
              Windows 的檔案操作機制執行，所以衝突處理、進度、取消與資源回收筒的行為
              都與檔案總管一致，剪貼簿也雙向互通。新增資料夾與重新命名仍留給檔案總管。
            </p>
            <dl class="space-y-1 text-[12px] text-ink-muted">
              <div class="flex gap-3">
                <dt class="w-24 shrink-0 text-ink-faint">外部工具</dt>
                <dd>{{ settings.tools.length }} 個</dd>
              </div>
              <div class="flex gap-3">
                <dt class="w-24 shrink-0 text-ink-faint">設定存放</dt>
                <dd>本機 localStorage，不會上傳</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
