<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { copyText } from "@/services/clipboard";
import { TOOL_ICONS, useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import type { ExternalTool, ToolTarget } from "@/types/tools";
import { TOOL_VARIABLES } from "@/utils/toolVars";

const settings = useSettingsStore();
const ui = useUiStore();
const selectedId = ref<string>(settings.tools[0]?.id ?? "");

const selected = computed(() => settings.tools.find((tool) => tool.id === selectedId.value) ?? null);

/**
 * 引數欄位保留使用者輸入的原始文字。
 *
 * 原本每次輸入都 trim + 過濾空行再寫回，結果按 Enter 產生的換行會立刻被
 * 同步回來的值吃掉，變成「不能換行」。現在原文照存，空行由執行時過濾。
 */
const argsDraft = ref("");
const argsEl = useTemplateRef<HTMLTextAreaElement>("argsEl");
const workdirEl = useTemplateRef<HTMLInputElement>("workdirEl");
/** 點變數時要插入哪個欄位：看最後聚焦的是引數還是工作目錄。 */
const lastField = ref<"args" | "workdir">("args");

watch(
  () => selected.value?.id,
  () => {
    argsDraft.value = selected.value?.args.join("\n") ?? "";
    lastField.value = "args";
  },
  { immediate: true },
);

// 只有內容真的不同才寫回，避免與 store 互相觸發。
watch(argsDraft, (text) => {
  const tool = selected.value;
  if (!tool) {
    return;
  }
  const next = text.split("\n");
  if (next.join("\n") !== tool.args.join("\n")) {
    patch({ args: next });
  }
});

/** 插入變數到最後聚焦的欄位；在引數欄位是插在游標位置。 */
function insertVariable(name: string) {
  if (lastField.value === "workdir" && selected.value) {
    patch({ workingDirectory: `${selected.value.workingDirectory}${name}` });
    void nextTick(() => workdirEl.value?.focus());
    return;
  }

  const element = argsEl.value;
  const text = argsDraft.value;
  const start = element?.selectionStart ?? text.length;
  const end = element?.selectionEnd ?? start;
  argsDraft.value = `${text.slice(0, start)}${name}${text.slice(end)}`;

  void nextTick(() => {
    element?.focus();
    const caret = start + name.length;
    element?.setSelectionRange(caret, caret);
  });
}

async function copyVariable(name: string) {
  const copied = await copyText(name);
  ui.showNotice(copied ? `已複製 ${name}` : "無法複製到剪貼簿");
}

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
        <h3 class="text-base font-semibold text-ink">外部工具</h3>
        <button
          type="button"
          class="rounded px-1.5 py-1 text-xs text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
          @click="settings.resetTools()"
        >
          恢復預設
        </button>
      </div>
      <p class="mt-1 text-sm leading-relaxed text-ink-muted">
        這些工具會出現在檔案與資料夾的右鍵選單上。引數與工作目錄都可以使用下方列出的變數。
      </p>

      <div class="mt-3 overflow-hidden rounded-xl border border-line">
        <button
          v-for="tool in settings.tools"
          :key="tool.id"
          type="button"
          class="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left pressable last:border-b-0"
          :class="tool.id === selectedId ? 'bg-accent-soft' : 'hover:bg-surface-hover active:bg-pressed'"
          @click="selectedId = tool.id"
        >
          <AppIcon :name="tool.icon" :size="15" class="shrink-0 text-ink-muted" />
          <span class="min-w-0 flex-1 truncate text-base text-ink">{{ tool.label }}</span>
          <span class="shrink-0 text-xs text-ink-faint">
            {{ tool.targets.length === 2 ? "檔案與資料夾" : tool.targets[0] === "file" ? "僅檔案" : "僅資料夾" }}
          </span>
          <code class="max-w-40 shrink-0 truncate text-xs text-ink-faint">{{ tool.executable || "未設定" }}</code>
          <span
            v-if="!tool.builtin"
            class="shrink-0 rounded p-1 text-ink-faint pressable hover:bg-surface-hover active:bg-pressed hover:text-danger"
            title="刪除這個工具"
            @click.stop="removeTool(tool.id)"
          >
            <AppIcon name="close" :size="11" />
          </span>
        </button>
      </div>

      <button
        type="button"
        class="mt-2 flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-sm text-ink pressable hover:bg-surface-hover active:bg-pressed"
        @click="addTool"
      >
        <AppIcon name="plus" :size="13" />
        新增自定義工具
      </button>
    </section>

    <section v-if="selected" class="rounded-xl border border-line bg-surface p-4">
      <h3 class="text-base font-semibold text-ink">編輯：{{ selected.label }}</h3>

      <div class="mt-3 grid gap-3">
        <label class="block">
          <span class="text-sm text-ink-muted">選單名稱</span>
          <input
            :value="selected.label"
            type="text"
            spellcheck="false"
            class="mt-1 h-8 w-full rounded-md border border-line bg-canvas px-2.5 text-base text-ink focus:border-accent focus:outline-none"
            @input="patch({ label: ($event.target as HTMLInputElement).value })"
          />
        </label>

        <label class="block">
          <span class="text-sm text-ink-muted">執行檔</span>
          <input
            :value="selected.executable"
            type="text"
            spellcheck="false"
            placeholder="例如 pwsh.exe 或 C:\tools\foo.exe"
            class="mt-1 h-8 w-full rounded-md border border-line bg-canvas px-2.5 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            @input="patch({ executable: ($event.target as HTMLInputElement).value })"
          />
          <span class="mt-1 block text-xs text-ink-faint">
            只寫名稱時會從系統 PATH 尋找；也可以直接給完整路徑。PowerShell 想用 7.x 就填
            <code class="rounded bg-surface-muted px-1">pwsh.exe</code>。
          </span>
        </label>

        <label class="block">
          <span class="text-sm text-ink-muted">引數（一行一個）</span>
          <textarea
            ref="argsEl"
            v-model="argsDraft"
            rows="3"
            spellcheck="false"
            placeholder="$fullFilePath"
            class="mt-1 w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            @focus="lastField = 'args'"
          />
        </label>

        <label class="block">
          <span class="text-sm text-ink-muted">工作目錄</span>
          <input
            ref="workdirEl"
            :value="selected.workingDirectory"
            type="text"
            spellcheck="false"
            placeholder="留空表示不指定，例如 $fullFolderPath"
            class="mt-1 h-8 w-full rounded-md border border-line bg-canvas px-2.5 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            @focus="lastField = 'workdir'"
            @input="patch({ workingDirectory: ($event.target as HTMLInputElement).value })"
          />
          <span class="mt-1 block text-xs text-ink-faint">
            新工具預設是「選取項目所在的資料夾」（<code class="rounded bg-surface-muted px-1">$fullFolderPath</code>）；
            留空表示沿用行程目前的位置。
          </span>
        </label>

        <div class="flex flex-wrap items-center gap-4">
          <span class="text-sm text-ink-muted">顯示於</span>
          <label class="flex items-center gap-1.5 text-sm text-ink">
            <input
              type="checkbox"
              class="size-3.5 accent-[var(--color-accent)]"
              :checked="selected.targets.includes('file')"
              @change="toggleTarget('file')"
            />
            檔案
          </label>
          <label class="flex items-center gap-1.5 text-sm text-ink">
            <input
              type="checkbox"
              class="size-3.5 accent-[var(--color-accent)]"
              :checked="selected.targets.includes('folder')"
              @change="toggleTarget('folder')"
            />
            資料夾
          </label>
          <label class="flex items-center gap-1.5 text-sm text-ink">
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
          <span class="text-sm text-ink-muted">圖示</span>
          <button
            v-for="icon in TOOL_ICONS"
            :key="icon"
            type="button"
            class="flex size-7 active:scale-95 items-center justify-center rounded-md border pressable"
            :class="
              selected.icon === icon
                ? 'border-accent/40 bg-accent-soft text-accent'
                : 'border-line text-ink-muted hover:bg-surface-hover active:bg-pressed hover:text-ink'
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
      <h3 class="text-base font-semibold text-ink">可用變數</h3>
      <p class="mt-1 text-xs text-ink-faint">
        點變數名稱會插入到最後聚焦的欄位（引數欄位是插在游標位置），右邊的圖示則複製到剪貼簿。
      </p>
      <dl class="mt-2 space-y-1.5">
        <div v-for="variable in TOOL_VARIABLES" :key="variable.name" class="flex items-center gap-2">
          <dt class="shrink-0">
            <button
              type="button"
              class="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-ink pressable hover:bg-accent-soft hover:text-accent"
              title="插入到最後聚焦的欄位"
              @click="insertVariable(variable.name)"
            >
              {{ variable.name }}
            </button>
          </dt>
          <button
            type="button"
            class="shrink-0 rounded p-1 text-ink-faint pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
            title="複製變數名稱"
            @click="copyVariable(variable.name)"
          >
            <AppIcon name="copy" :size="12" />
          </button>
          <dd class="min-w-0 flex-1 text-sm leading-relaxed text-ink-muted">
            {{ variable.description }}
          </dd>
        </div>
      </dl>
      <p class="mt-3 text-xs leading-relaxed text-ink-faint">
        沒有後綴的變數是「你按右鍵的那個項目」；後綴 1／2 分別固定取左／上與右／下的窗格，
        所以可以寫出「把左邊窗格的路徑丟給右邊的工具」這種組合。取不到值的變數會展開成空字串，
        整個引數變成空的時候會被略過。
      </p>
    </section>
  </div>
</template>
