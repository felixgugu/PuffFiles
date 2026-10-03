<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { TOOL_ICONS, useSettingsStore } from "@/stores/settings";
import type { ExternalTool, ToolTarget } from "@/types/tools";
import { TOOL_VARIABLES } from "@/utils/toolVars";

const settings = useSettingsStore();
const selectedId = ref<string>(settings.tools[0]?.id ?? "");

const selected = computed(() => settings.tools.find((tool) => tool.id === selectedId.value) ?? null);

/** 引數在 UI 上一行一個，避免用空白切字串把含空白的路徑切壞。 */
const argsText = computed({
  get: () => selected.value?.args.join("\n") ?? "",
  set: (value: string) =>
    patch({ args: value.split("\n").map((line) => line.trim()).filter(Boolean) }),
});

function patch(changes: Partial<ExternalTool>) {
  if (selected.value) {
    settings.updateTool(selected.value.id, changes);
  }
}

function toggleTarget(kind: ToolTarget) {
  const tool = selected.value;
  if (!tool) {
    return;
  }
  patch({
    targets: tool.targets.includes(kind)
      ? tool.targets.filter((value) => value !== kind)
      : [...tool.targets, kind],
  });
}

function addTool() {
  selectedId.value = settings.addTool().id;
}

function removeTool(id: string) {
  settings.removeTool(id);
  if (selectedId.value === id) {
    selectedId.value = settings.tools[0]?.id ?? "";
  }
}
</script>

<template>
  <div class="space-y-6">
    <section>
      <div class="flex items-baseline justify-between">
        <h3 class="text-[13px] font-semibold text-ink">外部工具</h3>
        <button
          type="button"
          class="rounded px-1.5 py-1 text-[11px] text-ink-muted transition-colors duration-75 hover:bg-surface-hover hover:text-ink"
          @click="settings.resetTools()"
        >
          恢復預設
        </button>
      </div>
      <p class="mt-1 text-[12px] leading-relaxed text-ink-muted">
        這些工具會出現在檔案與資料夾的右鍵選單上。引數與工作目錄都可以使用下方列出的變數。
      </p>

      <div class="mt-3 overflow-hidden rounded-xl border border-line">
        <button
          v-for="tool in settings.tools"
          :key="tool.id"
          type="button"
          class="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left transition-colors duration-75 last:border-b-0"
          :class="tool.id === selectedId ? 'bg-accent-soft' : 'hover:bg-surface-hover'"
          @click="selectedId = tool.id"
        >
          <AppIcon :name="tool.icon" :size="15" class="shrink-0 text-ink-muted" />
          <span class="min-w-0 flex-1 truncate text-[13px] text-ink">{{ tool.label }}</span>
          <span class="shrink-0 text-[11px] text-ink-faint">
            {{ tool.targets.length === 2 ? "檔案與資料夾" : tool.targets[0] === "file" ? "僅檔案" : "僅資料夾" }}
          </span>
          <code class="max-w-40 shrink-0 truncate text-[11px] text-ink-faint">{{ tool.executable || "未設定" }}</code>
          <span
            v-if="!tool.builtin"
            class="shrink-0 rounded p-1 text-ink-faint transition-colors duration-75 hover:bg-surface-hover hover:text-danger"
            title="刪除這個工具"
            @click.stop="removeTool(tool.id)"
          >
            <AppIcon name="close" :size="11" />
          </span>
        </button>
      </div>

      <button
        type="button"
        class="mt-2 flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink transition-colors duration-75 hover:bg-surface-hover"
        @click="addTool"
      >
        <AppIcon name="plus" :size="13" />
        新增自定義工具
      </button>
    </section>

    <section v-if="selected" class="rounded-xl border border-line bg-surface p-4">
      <h3 class="text-[13px] font-semibold text-ink">編輯：{{ selected.label }}</h3>

      <div class="mt-3 grid gap-3">
        <label class="block">
          <span class="text-[12px] text-ink-muted">選單名稱</span>
          <input
            :value="selected.label"
            type="text"
            spellcheck="false"
            class="mt-1 h-8 w-full rounded-md border border-line bg-canvas px-2.5 text-[13px] text-ink focus:border-accent focus:outline-none"
            @input="patch({ label: ($event.target as HTMLInputElement).value })"
          />
        </label>

        <label class="block">
          <span class="text-[12px] text-ink-muted">執行檔</span>
          <input
            :value="selected.executable"
            type="text"
            spellcheck="false"
            placeholder="例如 pwsh.exe 或 C:\tools\foo.exe"
            class="mt-1 h-8 w-full rounded-md border border-line bg-canvas px-2.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            @input="patch({ executable: ($event.target as HTMLInputElement).value })"
          />
          <span class="mt-1 block text-[11px] text-ink-faint">
            只寫名稱時會從系統 PATH 尋找；也可以直接給完整路徑。PowerShell 想用 7.x 就填
            <code class="rounded bg-surface-muted px-1">pwsh.exe</code>。
          </span>
        </label>

        <label class="block">
          <span class="text-[12px] text-ink-muted">引數（一行一個）</span>
          <textarea
            :value="argsText"
            rows="3"
            spellcheck="false"
            placeholder="$fullFilePath"
            class="mt-1 w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 font-mono text-[12px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            @input="argsText = ($event.target as HTMLTextAreaElement).value"
          />
        </label>

        <label class="block">
          <span class="text-[12px] text-ink-muted">工作目錄</span>
          <input
            :value="selected.workingDirectory"
            type="text"
            spellcheck="false"
            placeholder="留空表示不指定，例如 $fullFolderPath"
            class="mt-1 h-8 w-full rounded-md border border-line bg-canvas px-2.5 font-mono text-[12px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            @input="patch({ workingDirectory: ($event.target as HTMLInputElement).value })"
          />
        </label>

        <div class="flex flex-wrap items-center gap-4">
          <span class="text-[12px] text-ink-muted">顯示於</span>
          <label class="flex items-center gap-1.5 text-[12px] text-ink">
            <input
              type="checkbox"
              class="size-3.5 accent-[var(--color-accent)]"
              :checked="selected.targets.includes('file')"
              @change="toggleTarget('file')"
            />
            檔案
          </label>
          <label class="flex items-center gap-1.5 text-[12px] text-ink">
            <input
              type="checkbox"
              class="size-3.5 accent-[var(--color-accent)]"
              :checked="selected.targets.includes('folder')"
              @change="toggleTarget('folder')"
            />
            資料夾
          </label>
          <label class="flex items-center gap-1.5 text-[12px] text-ink">
            <input
              type="checkbox"
              class="size-3.5 accent-[var(--color-accent)]"
              :checked="selected.newConsole"
              @change="patch({ newConsole: ($event.target as HTMLInputElement).checked })"
            />
            開新主控台視窗
          </label>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-[12px] text-ink-muted">圖示</span>
          <button
            v-for="icon in TOOL_ICONS"
            :key="icon"
            type="button"
            class="flex size-7 items-center justify-center rounded-md border transition-colors duration-75"
            :class="
              selected.icon === icon
                ? 'border-accent/40 bg-accent-soft text-accent'
                : 'border-line text-ink-muted hover:bg-surface-hover hover:text-ink'
            "
            :title="icon"
            @click="patch({ icon })"
          >
            <AppIcon :name="icon" :size="14" />
          </button>
        </div>
      </div>
    </section>

    <section class="rounded-xl border border-line bg-surface p-4">
      <h3 class="text-[13px] font-semibold text-ink">可用變數</h3>
      <dl class="mt-2 space-y-1.5">
        <div v-for="variable in TOOL_VARIABLES" :key="variable.name" class="flex items-baseline gap-3">
          <dt class="w-36 shrink-0">
            <code class="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-ink">
              {{ variable.name }}
            </code>
          </dt>
          <dd class="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-muted">
            {{ variable.description }}
          </dd>
        </div>
      </dl>
      <p class="mt-3 text-[11px] leading-relaxed text-ink-faint">
        沒有後綴的變數是「你按右鍵的那個項目」；後綴 1／2 分別固定取左／上與右／下的窗格，
        所以可以寫出「把左邊窗格的路徑丟給右邊的工具」這種組合。取不到值的變數會展開成空字串，
        整個引數變成空的時候會被略過。
      </p>
    </section>
  </div>
</template>
