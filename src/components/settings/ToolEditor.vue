<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { copyText } from "@/services/clipboard";
import { TOOL_ICONS, useSettingsStore } from "@/stores/settings";
import { useToolEditorStore } from "@/stores/toolEditor";
import { useUiStore } from "@/stores/ui";
import type { ToolTarget } from "@/types/tools";
import { formatExtensions, normalizeExtensions } from "@/utils/tools";
import { TOOL_VARIABLES } from "@/utils/toolVars";

/**
 * 外部工具的編輯頁。
 *
 * 所有欄位改的是 `toolEditor` 的草稿，只有按「儲存」才寫回 settings；
 * 「引數」與「副檔名」另外保留使用者輸入的原文，空行與格式由後續處理吃下來
 * （見下方 watch 的說明）。
 */
const settings = useSettingsStore();
const editor = useToolEditorStore();
const ui = useUiStore();

const draft = computed(() => editor.draft);
const isCreate = computed(() => editor.mode === "create");

/**
 * 引數欄位保留使用者輸入的原始文字。
 *
 * 原本每次輸入都 trim + 過濾空行再寫回，結果按 Enter 產生的換行會立刻被
 * 同步回來的值吃掉，變成「不能換行」。現在原文照存，空行由執行時過濾。
 */
const argsDraft = ref("");
/** 副檔名欄位同樣保留使用者輸入的原文（`.7z`、`7z`、`7z, zip` 都算）。 */
const extDraft = ref("");
const argsEl = useTemplateRef<HTMLTextAreaElement>("argsEl");
const workdirEl = useTemplateRef<HTMLInputElement>("workdirEl");
/** 點變數時要插入哪個欄位：看最後聚焦的是引數還是工作目錄。 */
const lastField = ref<"args" | "workdir">("args");
const showVariables = ref(false);

// 草稿被整份換掉（開啟／取消／儲存）時，才把原文欄位重新同步一次。
watch(
  () => editor.revision,
  () => {
    argsDraft.value = editor.draft?.args.join("\n") ?? "";
    extDraft.value = formatExtensions(editor.draft?.extensions);
    lastField.value = "args";
  },
  { immediate: true },
);

// 只有內容真的不同才寫回，避免與 store 互相觸發。
watch(argsDraft, (text) => {
  const tool = editor.draft;
  if (!tool) {
    return;
  }
  const next = text.split("\n");
  if (next.join("\n") !== tool.args.join("\n")) {
    editor.patch({ args: next });
  }
});

// 同上：只有正規化後真的不同才寫回。
watch(extDraft, (text) => {
  const tool = editor.draft;
  if (!tool) {
    return;
  }
  const next = normalizeExtensions(text);
  if (next.join(" ") !== (tool.extensions ?? []).join(" ")) {
    editor.patch({ extensions: next });
  }
});

/** footer 左側的狀態文字，同時也是儲存鈕停用的原因。 */
const statusText = computed(() => {
  if (!editor.isValid) {
    return "請先填寫選單名稱與執行檔";
  }
  return editor.isDirty ? "尚未儲存的變更" : "沒有未儲存的變更";
});

function save() {
  const creating = isCreate.value;
  if (!editor.save()) {
    return;
  }
  ui.showNotice(creating ? "已新增工具" : `已儲存「${draft.value?.label ?? ""}」`);
}

async function leave() {
  await editor.leaveSection();
}

async function removeTool() {
  const tool = draft.value;
  if (!tool || tool.builtin || !editor.editingId) {
    return;
  }
  const accepted = await ui.confirm({
    title: "刪除工具？",
    message: `「${tool.label}」會從右鍵選單移除，這個動作無法復原。`,
    confirmText: "刪除",
  });
  if (!accepted) {
    return;
  }
  settings.removeTool(editor.editingId);
  editor.close();
  ui.showNotice(`已刪除「${tool.label}」`);
}

function toggleTarget(kind: ToolTarget) {
  const tool = draft.value;
  if (!tool) {
    return;
  }
  editor.patch({
    targets: tool.targets.includes(kind)
      ? tool.targets.filter((value) => value !== kind)
      : [...tool.targets, kind],
  });
}

/** 插入變數到最後聚焦的欄位；在引數欄位是插在游標位置。 */
function insertVariable(name: string) {
  if (lastField.value === "workdir" && draft.value) {
    editor.patch({ workingDirectory: `${draft.value.workingDirectory}${name}` });
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
</script>

<template>
  <div v-if="draft" class="space-y-6 pb-2">
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="flex h-7 items-center gap-1 rounded-md pr-2.5 pl-1.5 text-sm text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        title="回到工具清單"
        @click="leave()"
      >
        <AppIcon name="chevronLeft" :size="14" />
        返回
      </button>
      <h3 class="min-w-0 flex-1 truncate text-base font-semibold text-ink">
        {{ isCreate ? "新增工具" : `編輯：${draft.label || "未命名工具"}` }}
      </h3>
      <span
        v-if="draft.builtin"
        class="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-2xs text-ink-faint"
      >
        內建
      </span>
      <button
        v-else
        type="button"
        class="shrink-0 rounded-md px-2.5 py-1 text-xs text-danger pressable hover:bg-danger-soft active:bg-danger-soft"
        @click="removeTool()"
      >
        刪除工具
      </button>
    </div>

    <div class="space-y-3">
      <label class="block">
        <span class="text-sm text-ink-muted">選單名稱</span>
        <input
          :value="draft.label"
          type="text"
          spellcheck="false"
          placeholder="例如：用 7-Zip 解壓縮"
          class="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2.5 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          :class="editor.errorFor('label') ? 'border-danger' : ''"
          @input="editor.patch({ label: ($event.target as HTMLInputElement).value })"
          @blur="editor.markTouched('label')"
        />
        <span v-if="editor.errorFor('label')" class="mt-1 block text-xs text-danger">
          {{ editor.errorFor("label") }}
        </span>
      </label>

      <label class="block">
        <span class="text-sm text-ink-muted">執行檔</span>
        <input
          :value="draft.executable"
          type="text"
          spellcheck="false"
          placeholder="例如 pwsh.exe 或 C:\tools\foo.exe"
          class="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2.5 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          :class="editor.errorFor('executable') ? 'border-danger' : ''"
          @input="editor.patch({ executable: ($event.target as HTMLInputElement).value })"
          @blur="editor.markTouched('executable')"
        />
        <span v-if="editor.errorFor('executable')" class="mt-1 block text-xs text-danger">
          {{ editor.errorFor("executable") }}
        </span>
        <span v-else class="mt-1 block text-xs text-ink-faint">
          只寫名稱時會從系統 PATH 尋找；也可以直接給完整路徑。PowerShell 想用 7.x 就填
          <code class="rounded bg-surface-muted px-1">pwsh.exe</code>。
        </span>
      </label>

      <div>
        <label class="block">
          <span class="text-sm text-ink-muted">引數（一行一個）</span>
          <textarea
            ref="argsEl"
            v-model="argsDraft"
            rows="6"
            spellcheck="false"
            placeholder="$fullFilePath"
            class="mt-1 w-full rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            @focus="lastField = 'args'"
          />
        </label>

        <!--
          變數本來就是給引數用的，切換鈕貼在欄位右下角、展開區接在下面，
          不要讓它孤零零地待在表單最下面。展開區放在 label 之外，
          否則點變數會連帶觸發 label 的聚焦行為。
        -->
        <div class="mt-1 flex justify-end">
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-accent pressable hover:bg-accent-soft active:bg-accent-soft"
            :aria-expanded="showVariables"
            @click="showVariables = !showVariables"
          >
            <AppIcon
              name="chevronRight"
              :size="11"
              class="transition-transform duration-150 ease-out"
              :class="showVariables ? 'rotate-90' : ''"
            />
            可用變數
          </button>
        </div>

        <div v-if="showVariables" class="mt-2 border-t border-line pt-3">
          <p class="text-xs text-ink-faint">
            點變數名稱會插入到最後聚焦的欄位（引數欄位是插在游標位置），右邊的圖示則複製到剪貼簿。
          </p>
          <dl class="mt-2 space-y-1.5">
            <div
              v-for="variable in TOOL_VARIABLES"
              :key="variable.name"
              class="flex items-center gap-2"
            >
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
          <p class="mt-2 text-xs leading-relaxed text-ink-faint">
            多選時，單獨一行的 <code class="rounded bg-surface-muted px-1">$fullFilePath</code>
            會展開成多個引數（每個選取項目一個），整組 .zip 交給 7-Zip 就是這個用法；
            寫在文字中間時（例如
            <code class="rounded bg-surface-muted px-1">--file=$fullFilePath</code>）仍只代表右鍵的那一項。
          </p>
        </div>
      </div>

      <label class="block">
        <span class="text-sm text-ink-muted">工作目錄</span>
        <input
          ref="workdirEl"
          :value="draft.workingDirectory"
          type="text"
          spellcheck="false"
          placeholder="留空表示不指定，例如 $fullFolderPath"
          class="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2.5 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          @focus="lastField = 'workdir'"
          @input="editor.patch({ workingDirectory: ($event.target as HTMLInputElement).value })"
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
            :checked="draft.targets.includes('file')"
            @change="toggleTarget('file')"
          />
          檔案
        </label>
        <label class="flex items-center gap-1.5 text-sm text-ink">
          <input
            type="checkbox"
            class="size-3.5 accent-[var(--color-accent)]"
            :checked="draft.targets.includes('folder')"
            @change="toggleTarget('folder')"
          />
          資料夾
        </label>
        <label class="flex items-center gap-1.5 text-sm text-ink">
          <input
            type="checkbox"
            class="size-3.5 accent-[var(--color-accent)]"
            :checked="draft.newConsole"
            @change="editor.patch({ newConsole: ($event.target as HTMLInputElement).checked })"
          />
          開新主控台視窗
        </label>
      </div>

      <label class="block">
        <span class="text-sm text-ink-muted">副檔名（選填）</span>
        <input
          v-model="extDraft"
          type="text"
          spellcheck="false"
          :disabled="!draft.targets.includes('file')"
          placeholder=".7z .zip .rar"
          class="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2.5 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:opacity-50"
        />
        <span class="mt-1 block text-xs leading-relaxed text-ink-faint">
          填了就只出現在這些副檔名的檔案上（不分大小寫，可用空白、逗號或分號分隔）。
          例如 7-Zip 填 <code class="rounded bg-surface-muted px-1">.7z .zip .rar</code>；
          留空表示所有檔案。只在「顯示於：檔案」時有意義。
        </span>
      </label>

      <div class="flex items-center gap-2">
        <span class="text-sm text-ink-muted">圖示</span>
        <button
          v-for="icon in TOOL_ICONS"
          :key="icon"
          type="button"
          class="flex size-7 active:scale-95 items-center justify-center rounded-md border pressable"
          :class="
            draft.icon === icon
              ? 'border-accent/40 bg-accent-soft text-accent'
              : 'border-line text-ink-muted hover:bg-surface-hover active:bg-pressed hover:text-ink'
          "
          :title="icon"
          @click="editor.patch({ icon })"
        >
          <AppIcon :name="icon" :size="14" />
        </button>
      </div>
    </div>

    <!-- 儲存列：固定貼在捲動區底部，長表單也不用回頭找按鈕 -->
    <div
      class="sticky bottom-0 z-10 -mx-6 flex items-center gap-3 border-t border-line bg-canvas px-6 py-3"
    >
      <span class="min-w-0 flex-1 truncate text-xs text-ink-faint">{{ statusText }}</span>
      <button
        type="button"
        class="h-8 shrink-0 rounded-md border border-line px-3 text-base text-ink pressable hover:bg-surface-hover active:bg-pressed"
        @click="leave()"
      >
        取消
      </button>
      <button
        type="button"
        class="h-8 shrink-0 rounded-md bg-accent px-3 text-base font-medium text-accent-ink transition-opacity duration-75 hover:opacity-90 active:opacity-80 disabled:opacity-40 disabled:hover:opacity-40"
        :disabled="!editor.canSave"
        :title="editor.canSave ? '儲存這個工具' : statusText"
        @click="save()"
      >
        儲存
      </button>
    </div>
  </div>
</template>
