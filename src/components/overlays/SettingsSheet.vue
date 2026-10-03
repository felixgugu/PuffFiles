<script setup lang="ts">
import AppIcon from "@/components/common/AppIcon.vue";
import { ALL_COLUMNS, useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import type { MotionPreference, ThemeMode } from "@/stores/settings";

const settings = useSettingsStore();
const ui = useUiStore();

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
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0"
    leave-active-class="transition duration-150 ease-in"
    leave-to-class="opacity-0"
  >
    <div v-if="ui.settingsOpen" class="fixed inset-0 z-50 flex justify-end">
      <div class="flex-1 bg-black/20" @click="ui.settingsOpen = false" />

      <Transition
        appear
        enter-active-class="transition duration-[280ms] ease-out"
        enter-from-class="translate-x-6 opacity-0"
        leave-active-class="transition duration-200 ease-in"
        leave-to-class="translate-x-6 opacity-0"
      >
        <aside
          class="material-menu flex h-full w-[380px] flex-col overflow-hidden rounded-none border-y-0 border-r-0"
        >
          <header class="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
            <h2 class="text-[13px] font-semibold text-ink">設定</h2>
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors duration-75 hover:bg-surface-hover hover:text-ink"
              title="關閉"
              @click="ui.settingsOpen = false"
            >
              <AppIcon name="close" :size="14" />
            </button>
          </header>

          <div class="scroll-area min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <section>
              <h3 class="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">外觀</h3>
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

            <section class="mt-5">
              <h3 class="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">動態效果</h3>
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
                減少動態時，位移一律改為短暫的淡入淡出，不做彈跳。
              </p>
            </section>

            <section class="mt-5">
              <h3 class="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">瀏覽</h3>
              <label class="mt-2 flex items-center justify-between py-1.5">
                <span class="text-[13px] text-ink">顯示隱藏項目</span>
                <input
                  type="checkbox"
                  class="size-4 accent-[var(--color-accent)]"
                  :checked="settings.showHidden"
                  @change="settings.showHidden = ($event.target as HTMLInputElement).checked"
                />
              </label>
              <label class="flex items-center justify-between py-1.5">
                <span class="text-[13px] text-ink">啟動時還原上次的分頁與窗格</span>
                <input
                  type="checkbox"
                  class="size-4 accent-[var(--color-accent)]"
                  :checked="settings.restoreSession"
                  @change="settings.restoreSession = ($event.target as HTMLInputElement).checked"
                />
              </label>

              <p class="mt-3 text-[12px] text-ink-muted">顯示欄位</p>
              <div class="mt-1.5 flex flex-wrap gap-1">
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
                  @click="settings.toggleColumn(column.id)"
                >
                  {{ column.label }}
                </button>
              </div>
              <button
                type="button"
                class="mt-2 rounded px-1.5 py-1 text-[11px] text-ink-muted transition-colors duration-75 hover:bg-surface-hover hover:text-ink"
                @click="settings.resetColumnWidths()"
              >
                重設所有欄寬
              </button>
            </section>

            <section class="mt-5">
              <h3 class="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">外部工具</h3>
              <label class="mt-2 block text-[12px] text-ink-muted">Notepad++ 執行檔路徑</label>
              <input
                v-model="settings.notepadppPath"
                type="text"
                spellcheck="false"
                placeholder="留空則從 PATH 尋找 notepad++"
                class="mt-1 h-8 w-full rounded-md border border-line bg-canvas px-2.5 text-[12px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
              <label class="mt-3 block text-[12px] text-ink-muted">VS Code 執行檔路徑</label>
              <input
                v-model="settings.vscodePath"
                type="text"
                spellcheck="false"
                placeholder="留空則從 PATH 尋找 code"
                class="mt-1 h-8 w-full rounded-md border border-line bg-canvas px-2.5 text-[12px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
            </section>

            <p class="mt-6 text-[11px] leading-relaxed text-ink-faint">
              PuffFile 只做「快速回到工作資料夾」這一件事。檔案的新增、刪除與搬移一律留給 Windows 檔案總管。
            </p>
          </div>
        </aside>
      </Transition>
    </div>
  </Transition>
</template>
