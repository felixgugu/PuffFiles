import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import type { ExternalTool } from "@/types/tools";

export type ToolEditorView = "list" | "editor";
export type ToolEditorMode = "create" | "edit";

/** 編輯器的欄位錯誤；只在對應欄位被碰過或按過儲存後才顯示。 */
export interface ToolEditorErrors {
  label?: string;
  executable?: string;
}

/**
 * 固定欄位順序的快照，用來判斷草稿有沒有真的被改過。
 * 一定要與 `draftOf()` 成對使用，兩邊順序不同就永遠是 dirty。
 */
function snapshot(tool: ExternalTool): string {
  return JSON.stringify([
    tool.label,
    tool.executable,
    tool.args,
    tool.workingDirectory,
    tool.newConsole,
    tool.targets,
    tool.extensions ?? [],
    tool.icon,
  ]);
}

function draftOf(tool: ExternalTool): ExternalTool {
  return {
    ...tool,
    args: [...tool.args],
    targets: [...tool.targets],
    extensions: [...(tool.extensions ?? [])],
  };
}

/** 新增工具的起點：與 settings.addTool 的預設一致，但還沒有 id。 */
function blankTool(): ExternalTool {
  return {
    id: "",
    label: "",
    executable: "",
    args: ["$fullFilePath"],
    workingDirectory: "$fullFolderPath",
    newConsole: false,
    targets: ["file"],
    extensions: [],
    icon: "program",
  };
}

/**
 * 外部工具編輯器的草稿狀態。
 *
 * 設定頁改成「清單 → 編輯頁」兩段式之後，草稿必須跨元件被讀取
 * （SettingsView 的分類切換、Esc 快速鍵都要先問過未儲存的變更），
 * 所以放在 store 而不是元件區域狀態。草稿不會進 localStorage，
 * 只有按下「儲存」才會寫回 settings。
 */
export const useToolEditorStore = defineStore("toolEditor", () => {
  const settings = useSettingsStore();
  const ui = useUiStore();

  const view = ref<ToolEditorView>("list");
  const mode = ref<ToolEditorMode>("edit");
  const editingId = ref<string | null>(null);
  const draft = ref<ExternalTool | null>(null);
  const baseline = ref("");
  /** 按過儲存但驗證沒過時，強制顯示所有欄位錯誤。 */
  const showErrors = ref(false);
  /** 碰過的欄位（失焦後才顯示錯誤，避免一開始就滿江紅）。 */
  const touched = ref<string[]>([]);
  /** 草稿被整份換掉時遞增；編輯器用它把「引數／副檔名」的原文欄位重新同步。 */
  const revision = ref(0);

  const isDirty = computed(() => !!draft.value && snapshot(draft.value) !== baseline.value);

  const errors = computed<ToolEditorErrors>(() => {
    const result: ToolEditorErrors = {};
    if (!draft.value) {
      return result;
    }
    if (!draft.value.label.trim()) {
      result.label = "請填寫選單名稱";
    }
    if (!draft.value.executable.trim()) {
      result.executable = "請填寫執行檔，例如 pwsh.exe 或完整路徑";
    }
    return result;
  });

  const isValid = computed(() => !errors.value.label && !errors.value.executable);
  const canSave = computed(() => isDirty.value && isValid.value);

  function errorFor(field: keyof ToolEditorErrors): string {
    if (!showErrors.value && !touched.value.includes(field)) {
      return "";
    }
    return errors.value[field] ?? "";
  }

  function markTouched(field: keyof ToolEditorErrors) {
    if (!touched.value.includes(field)) {
      touched.value = [...touched.value, field];
    }
  }

  function openForEdit(id: string) {
    const tool = settings.tools.find((item) => item.id === id);
    if (!tool) {
      return;
    }
    mode.value = "edit";
    editingId.value = tool.id;
    draft.value = draftOf(tool);
    baseline.value = snapshot(draft.value);
    resetTransient();
    revision.value += 1;
    view.value = "editor";
  }

  function openForCreate() {
    mode.value = "create";
    editingId.value = null;
    draft.value = blankTool();
    baseline.value = snapshot(draft.value);
    resetTransient();
    revision.value += 1;
    view.value = "editor";
  }

  function resetTransient() {
    showErrors.value = false;
    touched.value = [];
  }

  function patch(changes: Partial<ExternalTool>) {
    if (draft.value) {
      draft.value = { ...draft.value, ...changes };
    }
  }

  /** 寫回 settings；成功回傳 true。驗證失敗時留在編輯頁並顯示錯誤。 */
  function save(): boolean {
    const tool = draft.value;
    if (!tool || !isDirty.value) {
      return false;
    }
    if (!isValid.value) {
      showErrors.value = true;
      return false;
    }
    const clean: ExternalTool = {
      ...tool,
      label: tool.label.trim(),
      executable: tool.executable.trim(),
    };
    if (mode.value === "create") {
      const created = settings.addTool(clean);
      mode.value = "edit";
      editingId.value = created.id;
      draft.value = { ...clean, id: created.id };
    } else if (editingId.value) {
      settings.updateTool(editingId.value, clean);
      draft.value = clean;
    } else {
      return false;
    }
    baseline.value = snapshot(draft.value);
    showErrors.value = false;
    touched.value = [];
    revision.value += 1;
    return true;
  }

  function close() {
    view.value = "list";
    mode.value = "edit";
    editingId.value = null;
    draft.value = null;
    baseline.value = "";
    resetTransient();
    revision.value += 1;
  }

  function currentLabel(): string {
    return draft.value?.label.trim() || "新工具";
  }

  /**
   * 離開編輯頁（或整個外部工具分類）前的守衛。
   * 回傳 false 代表使用者選擇留下，呼叫端必須中止這次離開。
   */
  async function leaveSection(): Promise<boolean> {
    if (view.value !== "editor") {
      return true;
    }
    if (!isDirty.value) {
      close();
      return true;
    }
    const picked = await ui.choose({
      title: "尚未儲存的變更",
      message: `「${currentLabel()}」還有沒儲存的修改。`,
      options: [
        { id: "cancel", label: "取消" },
        { id: "discard", label: "捨棄變更", tone: "danger" },
        { id: "save", label: "儲存並離開", tone: "primary" },
      ],
    });
    if (picked === "save") {
      const label = currentLabel();
      if (!save()) {
        return false;
      }
      ui.showNotice(`已儲存「${label}」`);
      close();
      return true;
    }
    if (picked === "discard") {
      close();
      return true;
    }
    return false;
  }

  return {
    view,
    mode,
    editingId,
    draft,
    revision,
    isDirty,
    isValid,
    canSave,
    errors,
    errorFor,
    markTouched,
    openForEdit,
    openForCreate,
    patch,
    save,
    close,
    leaveSection,
  };
});

// 與其他 store 相同：setup store 內有非響應式狀態，熱更新無法安全接手。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
