import { computed, type ComputedRef } from "vue";
import type { ViewerState } from "@/types/viewer";
import { renderMarkdown, type RenderedMarkdown } from "@/utils/markdown";
import { parentOf } from "@/utils/path";

const EMPTY: RenderedMarkdown = { html: "", localImages: [], headings: [] };

interface CachedRender {
  text: string;
  baseDir: string;
  result: RenderedMarkdown;
}

/**
 * 同一個檢視器狀態只渲染一次。
 *
 * 標頭需要標題數量（決定目錄索引開關能不能按），內容區需要完整的 HTML；
 * 兩邊各算一次等於把大檔解析兩遍，所以用 `WeakMap` 以 `ViewerState` 為鍵
 * 記住結果。文字是整份置換的，用參考比較就能判斷有沒有換檔案或重新載入。
 */
const cache = new WeakMap<object, CachedRender>();

export function renderedMarkdownOf(state: ViewerState | null | undefined): RenderedMarkdown {
  if (!state || state.kind !== "markdown") {
    return EMPTY;
  }
  const text = state.text ?? "";
  const baseDir = parentOf(state.path) ?? "";
  const cached = cache.get(state);
  if (cached && cached.text === text && cached.baseDir === baseDir) {
    return cached.result;
  }
  const result = renderMarkdown(text, baseDir);
  cache.set(state, { text, baseDir, result });
  return result;
}

/** 檢視器狀態 → 渲染結果（含目錄）。 */
export function useMarkdownOutline(state: ComputedRef<ViewerState | null>) {
  return computed(() => renderedMarkdownOf(state.value));
}
