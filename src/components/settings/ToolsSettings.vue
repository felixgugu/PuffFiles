<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import ToolEditor from "./ToolEditor.vue";
import { useSettingsStore } from "@/stores/settings";
import { useToolEditorStore } from "@/stores/toolEditor";
import { useUiStore } from "@/stores/ui";
import type { ExternalTool } from "@/types/tools";
import { formatExtensions } from "@/utils/tools";

/**
 * 外部工具的入口：工具清單（可篩選），點一列就進編輯頁。
 *
 * 清單本身不再直接改資料；新增與修改都在 `ToolEditor` 的草稿裡完成，
 * 按「儲存」才寫回 settings（見 `stores/toolEditor.ts`）。
 */
const settings = useSettingsStore();
const editor = useToolEditorStore();
const ui = useUiStore();

const query = ref("");

/** 依名稱與執行檔篩選；不分大小寫。 */
const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  if (!needle) {
    return settings.tools;
  }
  return settings.tools.filter(
    (tool) =>
      tool.label.toLocaleLowerCase().includes(needle) ||
      tool.executable.toLocaleLowerCase().includes(needle),
  );
});

/** 右邊的摘要：顯示於哪裡，以及有沒有限定副檔名。 */
function targetSummary(tool: ExternalTool): string {
  if (!tool.targets.length) {
    return "未指定顯示位置";
  }
  const where =
    tool.targets.length === 2 ? "檔案與資料夾" : tool.targets[0] === "file" ? "僅檔案" : "僅資料夾";
  const extensions = formatExtensions(tool.extensions);
  return extensions ? `${where} · ${extensions}` : where;
}

async function resetTools() {
  const accepted = await ui.confirm({
    title: "恢復預設工具？",
    message: "內建的四個工具會回到預設內容，自訂工具不受影響。",
    confirmText: "恢復預設",
  });
  if (accepted) {
    settings.resetTools();
  }
}
</script>

<template>
  <ToolEditor v-if="editor.view === 'editor'" />

  <section v-else class="py-6 first:pt-0 last:pb-0">
    <div class="flex items-baseline justify-between">
      <h3 class="text-base font-semibold text-ink">外部工具</h3>
      <button
        type="button"
        class="rounded px-1.5 py-1 text-xs text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        @click="resetTools()"
      >
        恢復預設
      </button>
    </div>
    <p class="mt-1 text-sm leading-relaxed text-ink-muted">
      這些工具會出現在檔案與資料夾的右鍵選單上。點一個工具就能編輯它的執行檔、引數與顯示條件。
    </p>

    <div class="mt-3 flex items-center gap-2">
      <div class="relative min-w-0 flex-1">
        <AppIcon
          name="search"
          :size="13"
          class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint"
        />
        <input
          v-model="query"
          type="text"
          spellcheck="false"
          placeholder="篩選工具（名稱或執行檔）"
          class="h-8 w-full rounded-md border border-line bg-surface pr-8 pl-8 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <button
          v-if="query"
          type="button"
          class="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded text-ink-faint pressable hover:bg-surface-hover hover:text-ink"
          title="清除篩選"
          @click="query = ''"
        >
          <AppIcon name="close" :size="12" />
        </button>
      </div>
      <button
        type="button"
        class="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-sm text-ink pressable hover:bg-surface-hover active:bg-pressed"
        @click="editor.openForCreate()"
      >
        <AppIcon name="plus" :size="13" />
        新增自定義工具
      </button>
    </div>

    <div v-if="filtered.length" class="mt-3 overflow-hidden rounded-xl border border-line">
      <button
        v-for="tool in filtered"
        :key="tool.id"
        type="button"
        class="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left pressable last:border-b-0 hover:bg-surface-hover active:bg-pressed"
        :title="`編輯「${tool.label}」`"
        @click="editor.openForEdit(tool.id)"
      >
        <AppIcon :name="tool.icon" :size="15" class="shrink-0 text-ink-muted" />
        <span class="min-w-0 flex-1 truncate text-base text-ink">{{ tool.label }}</span>
        <span class="max-w-44 shrink-0 truncate text-xs text-ink-faint">
          {{ targetSummary(tool) }}
        </span>
        <code class="max-w-40 shrink-0 truncate text-xs text-ink-faint">{{
          tool.executable || "未設定"
        }}</code>
        <span
          v-if="tool.builtin"
          class="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-2xs text-ink-faint"
        >
          內建
        </span>
        <AppIcon name="chevronRight" :size="13" class="shrink-0 text-ink-faint" />
      </button>
    </div>

    <div
      v-else
      class="mt-3 flex flex-col items-center gap-2 rounded-xl border border-line px-4 py-8 text-center"
    >
      <AppIcon name="search" :size="18" class="text-ink-faint" />
      <p class="text-sm text-ink-muted">找不到符合「{{ query.trim() }}」的工具</p>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        @click="query = ''"
      >
        清除篩選
      </button>
    </div>

    <p class="mt-3 text-xs leading-relaxed text-ink-faint">
      每個工具都有獨立的編輯頁，改完記得按「儲存」；內建工具可以編輯，自訂工具則可以刪除。
    </p>
  </section>
</template>
