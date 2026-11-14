<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import {
  MAX_EXTENSIONS_PER_GROUP,
  MAX_QUICK_FILTER_GROUPS,
  OTHER_GROUP_ID,
  parseExtensions,
  type FileTypeGroup,
} from "@/utils/fileTypes";

/**
 * 設定頁的「快速篩選」分頁。
 *
 * 這裡調整的是路徑列漏斗鈕的內容與順序：內建種類可以停用／啟用與上下移動，
 * 自訂種類另外可以刪除。改動立刻寫回 settings（與其他設定欄位一樣即時生效），
 * 正在使用被停用種類的窗格會由 `stores/explorer.ts` 自動清掉那一項篩選。
 */
const settings = useSettingsStore();
const ui = useUiStore();

const label = ref("");
const extensions = ref("");

const full = computed(() => settings.quickFilters.length >= MAX_QUICK_FILTER_GROUPS);
const parsed = computed(() => parseExtensions(extensions.value));
const canAdd = computed(() => parsed.value.length > 0 && !full.value);

async function add() {
  if (!parsed.value.length) {
    ui.showNotice("請輸入至少一個副檔名（例如 pdf 或 .pdf）");
    return;
  }
  if (full.value) {
    ui.showNotice(`最多只能有 ${MAX_QUICK_FILTER_GROUPS} 組快速篩選`);
    return;
  }
  const group = settings.addQuickFilter(label.value, extensions.value);
  if (!group) {
    ui.showNotice("這個種類新增不了（副檔名格式不正確）");
    return;
  }
  label.value = "";
  extensions.value = "";
  ui.showNotice(`已新增「${group.label}」`);
}

async function remove(group: FileTypeGroup) {
  const accepted = await ui.confirm({
    title: "刪除自訂種類？",
    message: `「${group.label}」會從漏斗鈕移除；正在使用它的窗格會自動清除那一項篩選。`,
    confirmText: "刪除",
  });
  if (accepted) {
    settings.removeQuickFilter(group.id);
  }
}

async function reset() {
  const accepted = await ui.confirm({
    title: "重設快速篩選？",
    message: "會回到預設的內建種類（含 .pdf），自訂種類會全部刪除；順序與停用狀態也會一併重設。",
    confirmText: "重設",
  });
  if (accepted) {
    settings.resetQuickFilters();
  }
}
</script>

<template>
  <div class="divide-y divide-line">
    <section class="py-6 first:pt-0 last:pb-0">
      <div class="flex items-baseline justify-between gap-4">
        <h3 class="text-base font-semibold text-ink">快速篩選</h3>
        <button
          type="button"
          class="shrink-0 rounded px-1.5 py-1 text-xs text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
          @click="reset"
        >
          重設為預設
        </button>
      </div>
      <p class="mt-1 text-sm leading-relaxed text-ink-muted">
        路徑列的搜尋框右邊有一顆漏斗鈕，它列的種類就是下面這份清單（依這裡的順序）。
        每個窗格各自記住選取的種類、換資料夾仍保留；篩選時不列資料夾，與搜尋關鍵字是「且」。
        停用的種類不會出現在漏斗鈕；選了「其它」時，停用種類的檔案也會算進「其它」
        （「其它」＝不在目前啟用的具名種類裡的檔案，含沒有副檔名）。
      </p>
      <p class="mt-1 text-xs text-ink-faint">
        目前 {{ settings.quickFilters.length }} / {{ MAX_QUICK_FILTER_GROUPS }} 組；內建種類可以停用但
        不能刪除，自訂種類可以刪除。
      </p>
    </section>

    <section class="py-6 first:pt-0 last:pb-0">
      <h3 class="text-base font-semibold text-ink">漏斗鈕裡的種類</h3>

      <ul class="mt-2 divide-y divide-line/60">
        <li
          v-for="(group, index) in settings.quickFilters"
          :key="group.id"
          class="flex items-center gap-2 py-1.5"
        >
          <input
            type="checkbox"
            class="size-4 shrink-0 accent-[var(--color-accent)]"
            :checked="group.enabled"
            :aria-label="`顯示「${group.label}」`"
            :title="group.enabled ? '停用：不顯示在漏斗鈕' : '啟用：顯示在漏斗鈕'"
            @change="settings.toggleQuickFilter(group.id)"
          />

          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-1.5">
              <span class="truncate text-sm" :class="group.enabled ? 'text-ink' : 'text-ink-faint'">
                {{ group.label }}
              </span>
              <span
                v-if="group.id === OTHER_GROUP_ID || group.builtin"
                class="shrink-0 rounded bg-surface-muted px-1 text-2xs text-ink-faint"
              >
                內建
              </span>
              <span
                v-else
                class="shrink-0 rounded bg-surface-muted px-1 text-2xs text-ink-faint"
              >
                自訂
              </span>
            </div>
            <p class="truncate text-xs text-ink-faint" :title="group.hint">{{ group.hint }}</p>
          </div>

          <div class="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded text-ink-muted pressable enabled:hover:bg-surface-hover enabled:hover:text-ink disabled:opacity-25"
              :disabled="index === 0"
              title="往上移"
              aria-label="往上移"
              @click="settings.moveQuickFilter(group.id, -1)"
            >
              <AppIcon name="chevronUp" :size="13" />
            </button>
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded text-ink-muted pressable enabled:hover:bg-surface-hover enabled:hover:text-ink disabled:opacity-25"
              :disabled="index === settings.quickFilters.length - 1"
              title="往下移"
              aria-label="往下移"
              @click="settings.moveQuickFilter(group.id, 1)"
            >
              <AppIcon name="chevronDown" :size="13" />
            </button>
            <button
              v-if="!group.builtin"
              type="button"
              class="flex size-6 items-center justify-center rounded text-ink-muted pressable hover:bg-surface-hover hover:text-danger"
              title="刪除這個自訂種類"
              aria-label="刪除這個自訂種類"
              @click="remove(group)"
            >
              <AppIcon name="trash" :size="13" />
            </button>
            <span v-else class="size-6" aria-hidden="true" />
          </div>
        </li>
      </ul>
    </section>

    <section class="py-6 first:pt-0 last:pb-0">
      <h3 class="text-base font-semibold text-ink">新增自訂種類</h3>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <input
          v-model="label"
          type="text"
          placeholder="名稱（留空＝用第一個副檔名）"
          spellcheck="false"
          autocomplete="off"
          class="h-8 min-w-40 flex-1 rounded-md border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          @keydown.enter.prevent="add"
        />
        <input
          v-model="extensions"
          type="text"
          placeholder="副檔名，例如 psd ai 或 .psd,.ai"
          spellcheck="false"
          autocomplete="off"
          class="h-8 w-60 rounded-md border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          @keydown.enter.prevent="add"
        />
        <button
          type="button"
          class="h-8 shrink-0 rounded-md border border-line px-3 text-sm text-ink pressable enabled:hover:bg-surface-hover enabled:active:bg-pressed disabled:opacity-40"
          :disabled="!canAdd"
          @click="add"
        >
          新增
        </button>
      </div>
      <p class="mt-1.5 text-xs leading-relaxed text-ink-faint">
        只填最後一段副檔名（`tar.gz` 請填 `gz`）；逗號、空白或頓號分隔，開頭的點可以省略。
        一組最多 {{ MAX_EXTENSIONS_PER_GROUP }} 個副檔名；同一個副檔名可以同時屬於多組
        （選了任一邊都符合）。
      </p>
    </section>
  </div>
</template>
