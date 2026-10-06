/**
 * 輕量 Markdown 渲染器。
 *
 * 原本規劃用 markdown-it，但這個開發環境連不到 npm registry，裝不了相依套件，
 * 因此自帶一支零依賴、可獨立測試的實作，涵蓋日常筆記用得到的子集：
 * 標題、段落、**粗體**、*斜體*、`程式碼`、圍籬程式碼區塊、清單、引用、
 * 分隔線、GFM 表格、刪除線、自動連結、連結與圖片。
 *
 * 兩個安全預設與 markdown-it 的建議設定一致：
 * - 不執行原始 HTML（一律 escape 成文字）。
 * - 連結與圖片只允許 http(s)、mailto、data:image 與本機相對路徑。
 *
 * 標題另外產生唯一 id 並收集成 `headings`，供檢視器的目錄索引與文件內
 * `#錨點` 連結使用；id 只由標題文字決定，同一份文件重複時加流水號。
 *
 * 對外介面刻意維持單純（原始碼 + 基準資料夾 → HTML + 待載入的本機圖片 + 目錄），
 * 日後能取得 markdown-it 時可以直接替換實作而不動呼叫端。
 */

import { resolveLocalPath } from "@/utils/path";

/** 目錄索引的一項；`id` 同時是內文標題的 DOM id。 */
export interface MarkdownHeading {
  id: string;
  level: number;
  text: string;
}

export interface RenderedMarkdown {
  html: string;
  /** 需要另外透過 IPC 讀取的本機圖片絕對路徑（依出現順序去重）。 */
  localImages: string[];
  /** 依文件順序排列的 h1～h6。 */
  headings: MarkdownHeading[];
}

interface Context {
  baseDir: string;
  images: string[];
  headings: MarkdownHeading[];
  /** slug → 已經用過的次數；重複標題靠它加流水號。 */
  slugs: Map<string, number>;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/** 反斜線可以逃逸的字元。 */
const ESCAPABLE = "\\`*_{}[]()#+-.!|~>";

/*
 * 步數預算：渲染是同步的，一旦有任何迴圈沒有前進，整個 WebView 會卡死、
 * 窗格永遠停在空白。這裡替每一次渲染設下與輸入大小成比例的預算，
 * 超過就丟錯，由 `renderMarkdown` 接手退回原始文字 —— 寧可顯示原始碼，
 * 也不要讓使用者面對一片空白又無法操作的畫面。
 */
let steps = 0;
let stepBudget = 0;

function spendStep() {
  if (++steps > stepBudget) {
    throw new Error("內容結構過於複雜，已停止解析");
  }
}

/** HTML 轉義；檢視器把純文字轉成 HTML 時也共用這一份。 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char]);
}

function isExternalUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url);
}

function isDataImage(url: string): boolean {
  return /^data:image\//i.test(url);
}

/** 擋掉會執行的 URL；本機路徑、相對路徑與錨點都算安全。 */
function isSafeUrl(url: string): boolean {
  const compact = url.replace(/[\u0000-\u0020]/g, "");
  if (/^(javascript|vbscript|file):/i.test(compact)) {
    return false;
  }
  if (/^data:/i.test(compact)) {
    return isDataImage(url);
  }
  return true;
}

/* ---------------------------------------------------------------------------
 * 行內語法
 * ------------------------------------------------------------------------- */

interface ParsedLink {
  text: string;
  href: string;
  end: number;
}

/** 解析 `[文字](目標 "標題")`；`start` 必須指向 `[`。 */
function parseLink(source: string, start: number): ParsedLink | null {
  let depth = 0;
  let close = -1;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === "\n") {
      return null;
    }
    if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1 || source[close + 1] !== "(") {
    return null;
  }

  let parens = 0;
  let end = -1;
  for (let i = close + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === "(") {
      parens++;
    } else if (char === ")") {
      parens--;
      if (parens === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    return null;
  }

  const inner = source.slice(close + 2, end).trim();
  // `<目標>` 或 `目標`，後面可接 "標題"（標題一律忽略，只用來吃掉語法）。
  const matched = /^(<[^>]*>|\S+)(?:\s+["'(].*["')])?$/.exec(inner);
  if (!matched) {
    return null;
  }
  return {
    text: source.slice(start + 1, close),
    href: matched[1].replace(/^<|>$/g, ""),
    end: end + 1,
  };
}

/** 找出行內強調的收尾符號；避免吃到空白結尾（`* 不是強調 *`）。 */
function findClosing(source: string, from: number, marker: string): number {
  let index = source.indexOf(marker, from);
  while (index !== -1) {
    if (index > from && !/\s/.test(source[index - 1])) {
      return index;
    }
    index = source.indexOf(marker, index + 1);
  }
  return -1;
}

function renderInline(source: string, ctx: Context): string {
  let html = "";
  let plain = "";
  let index = 0;

  const flush = () => {
    if (plain) {
      html += escapeHtml(plain);
      plain = "";
    }
  };

  while (index < source.length) {
    spendStep();
    const char = source[index];

    if (char === "\\" && index + 1 < source.length && ESCAPABLE.includes(source[index + 1])) {
      plain += source[index + 1];
      index += 2;
      continue;
    }

    if (char === "\n") {
      flush();
      html += "<br>";
      index++;
      continue;
    }

    if (char === "`") {
      let run = 0;
      while (source[index + run] === "`") {
        run++;
      }
      const fence = "`".repeat(run);
      const close = source.indexOf(fence, index + run);
      if (close !== -1) {
        flush();
        let code = source.slice(index + run, close);
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) {
          code = code.slice(1, -1);
        }
        html += `<code class="md-code">${escapeHtml(code)}</code>`;
        index = close + run;
        continue;
      }
    }

    if (char === "!" && source[index + 1] === "[") {
      const link = parseLink(source, index + 1);
      if (link) {
        flush();
        html += renderImage(link.text, link.href, ctx);
        index = link.end;
        continue;
      }
    }

    if (char === "[") {
      const link = parseLink(source, index);
      if (link) {
        flush();
        html += renderLink(link.text, link.href, ctx);
        index = link.end;
        continue;
      }
    }

    if (char === "<") {
      const uri = /^<([a-zA-Z][a-zA-Z0-9+.-]*:[^<>\s]+)>/.exec(source.slice(index));
      if (uri) {
        flush();
        html += renderLink(uri[1], uri[1], ctx);
        index += uri[0].length;
        continue;
      }
      const mail = /^<([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>/.exec(source.slice(index));
      if (mail) {
        flush();
        html += renderLink(mail[1], `mailto:${mail[1]}`, ctx);
        index += mail[0].length;
        continue;
      }
    }

    const strong =
      (char === "*" && source.startsWith("**", index)) ||
      (char === "_" && source.startsWith("__", index));
    if (strong) {
      const marker = source.slice(index, index + 2);
      const close = findClosing(source, index + 2, marker);
      if (close > index + 2) {
        flush();
        html += `<strong>${renderInline(source.slice(index + 2, close), ctx)}</strong>`;
        index = close + 2;
        continue;
      }
    }

    if (char === "~" && source.startsWith("~~", index)) {
      const close = findClosing(source, index + 2, "~~");
      if (close > index + 2) {
        flush();
        html += `<del>${renderInline(source.slice(index + 2, close), ctx)}</del>`;
        index = close + 2;
        continue;
      }
    }

    if (char === "*" || char === "_") {
      const close = findClosing(source, index + 1, char);
      if (close > index + 1) {
        flush();
        html += `<em>${renderInline(source.slice(index + 1, close), ctx)}</em>`;
        index = close + 1;
        continue;
      }
    }

    if (char === "h" || char === "w") {
      const url = /^(https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+)/.exec(source.slice(index));
      const boundary = index === 0 || !/[\w@/]/.test(source[index - 1]);
      if (url && boundary) {
        flush();
        const href = url[1].startsWith("www.") ? `http://${url[1]}` : url[1];
        html += `<a class="md-link" href="${escapeHtml(href)}" data-viewer-external="${escapeHtml(
          href,
        )}" rel="noreferrer">${escapeHtml(url[1])}</a>`;
        index += url[1].length;
        continue;
      }
    }

    plain += char;
    index++;
  }

  flush();
  return html;
}

function renderImage(alt: string, source: string, ctx: Context): string {
  const label = escapeHtml(alt);
  if (!source || !isSafeUrl(source) || source.startsWith("#")) {
    return label;
  }
  if (isExternalUrl(source) || isDataImage(source)) {
    return `<img class="md-image" src="${escapeHtml(source)}" alt="${label}" loading="lazy">`;
  }
  const resolved = resolveLocalPath(ctx.baseDir, source);
  if (!resolved) {
    return label;
  }
  if (!ctx.images.includes(resolved)) {
    ctx.images.push(resolved);
  }
  return `<img class="md-image" data-viewer-image="${escapeHtml(resolved)}" alt="${label}">`;
}

function renderLink(text: string, href: string, ctx: Context): string {
  const target = href.trim();
  if (!target || !isSafeUrl(target)) {
    return escapeHtml(text);
  }
  const label = renderInline(text, ctx);
  if (target.startsWith("#")) {
    // 標題已經有 id，`#錨點` 可以真的跳過去；空錨點維持純文字。
    const fragment = target.slice(1).trim();
    if (!fragment) {
      return `<span class="md-anchor">${label}</span>`;
    }
    return `<a class="md-link md-anchor" href="#" data-viewer-anchor="${escapeHtml(
      fragment,
    )}">${label}</a>`;
  }
  if (isExternalUrl(target)) {
    return `<a class="md-link" href="${escapeHtml(target)}" data-viewer-external="${escapeHtml(
      target,
    )}" rel="noreferrer">${label}</a>`;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) {
    return `<span class="md-link">${label}</span>`;
  }
  const resolved = resolveLocalPath(ctx.baseDir, target);
  if (!resolved) {
    return label;
  }
  return `<a class="md-link" href="#" data-viewer-local="${escapeHtml(resolved)}">${label}</a>`;
}

/* ---------------------------------------------------------------------------
 * 標題 id 與目錄
 * ------------------------------------------------------------------------- */

/**
 * 把行內語法渲染出的 HTML 還原成純文字，用來當目錄標籤與 slug 來源。
 *
 * 目錄顯示的是「標題的文字」，不該帶著 `<code>` 或連結的標記；沿用同一份
 * 行內渲染結果再拆掉標籤，才能保證目錄與內文看到的是同一串字。
 */
function plainFromHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** 標題 slug：保留中文、英數、`-` 與 `_`，其餘去掉；空白轉連字號。 */
function slugFor(text: string): string {
  const slug = text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

/** 同一份文件裡重複的標題加流水號，錨點才不會互相蓋掉。 */
function uniqueHeadingId(ctx: Context, text: string): string {
  const base = slugFor(text);
  const seen = ctx.slugs.get(base) ?? 0;
  ctx.slugs.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen}`;
}

/** 產生帶 id 的標題，並把目錄項目依文件順序收集起來。 */
function renderHeading(level: number, source: string, ctx: Context): string {
  const inner = renderInline(source, ctx);
  const text = plainFromHtml(inner);
  const id = uniqueHeadingId(ctx, text);
  ctx.headings.push({ id, level, text });
  return `<h${level} id="${escapeHtml(id)}">${inner}</h${level}>`;
}

/* ---------------------------------------------------------------------------
 * 區塊語法
 * ------------------------------------------------------------------------- */

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})\s*([^`]*)$/;
const HORIZONTAL_RULE = /^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/;
const ATX_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BLOCK_QUOTE = /^ {0,3}>/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const SETEXT_H1 = /^ {0,3}=+\s*$/;
const SETEXT_H2 = /^ {0,3}-+\s*$/;

function isTableSeparator(line: string): boolean {
  return !!line && /^ {0,3}\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line);
}

/** 表格的判定除了分隔線，還要求欄數對得起來（否則只是剛好有 `|` 的段落）。 */
function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index] ?? "";
  const separator = lines[index + 1] ?? "";
  if (!header.includes("|") || !isTableSeparator(separator)) {
    return false;
  }
  return splitTableRow(header).length === splitTableRow(separator).length;
}

/** 這一行是不是某個區塊的開頭（段落遇到它就要收尾）。 */
function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (!line.trim()) {
    return true;
  }
  if (FENCE_OPEN.test(line) || HORIZONTAL_RULE.test(line) || ATX_HEADING.test(line)) {
    return true;
  }
  if (BLOCK_QUOTE.test(line) || LIST_ITEM.test(line)) {
    return true;
  }
  return isTableStart(lines, index);
}

function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) {
    text = text.slice(1);
  }
  if (text.endsWith("|") && !text.endsWith("\\|")) {
    text = text.slice(0, -1);
  }

  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\\" && text[i + 1] === "|") {
      current += "|";
      i++;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function renderTable(lines: string[], start: number, ctx: Context): { html: string; next: number } {
  const header = splitTableRow(lines[start]);
  const alignments = splitTableRow(lines[start + 1]).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });

  let index = start + 2;
  const rows: string[][] = [];
  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    rows.push(splitTableRow(lines[index]));
    index++;
  }

  const cell = (tag: "th" | "td", value: string, column: number) => {
    const align = alignments[column] ? ` style="text-align:${alignments[column]}"` : "";
    return `<${tag}${align}>${renderInline(value, ctx)}</${tag}>`;
  };

  const head = header.map((value, column) => cell("th", value, column)).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${header
          .map((_, column) => cell("td", row[column] ?? "", column))
          .join("")}</tr>`,
    )
    .join("");

  return {
    html: `<table class="md-table"><thead><tr>${head}</tr></thead>${
      body ? `<tbody>${body}</tbody>` : ""
    }</table>`,
    next: index,
  };
}

function renderList(lines: string[], start: number, ctx: Context): { html: string; next: number } {
  const first = LIST_ITEM.exec(lines[start])!;
  const ordered = /^\d/.test(first[2]);
  const baseIndent = first[1].length;
  const contentIndent = baseIndent + first[2].length + 1;

  const items: string[][] = [];
  let index = start;

  while (index < lines.length) {
    const item = LIST_ITEM.exec(lines[index]);
    if (!item || item[1].length !== baseIndent || /^\d/.test(item[2]) !== ordered) {
      break;
    }

    /*
     * `- `／`* `／`1. ` 這種只有符號、沒有內容的行也要算一個項目：
     * 直接 break 會讓 index 停在原地，整個渲染器就卡在無限迴圈裡（畫面永遠空白）。
     */
    const body: string[] = item[3].trim() ? [item[3]] : [];
    index++;
    let blanks: string[] = [];

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        const next = lines[index + 1] ?? "";
        const nextIndent = next.match(/^ */)?.[0].length ?? 0;
        if (next.trim() && nextIndent >= contentIndent) {
          blanks.push("");
          index++;
          continue;
        }
        break;
      }

      const indent = line.match(/^ */)?.[0].length ?? 0;
      if (indent >= contentIndent) {
        body.push(...blanks, line.slice(contentIndent));
        blanks = [];
        index++;
        continue;
      }
      // 縮排只比項目多一點的續行（寬鬆寫法）也算同一項。
      if (indent > baseIndent && !LIST_ITEM.test(line)) {
        body.push(...blanks, line.trimStart());
        blanks = [];
        index++;
        continue;
      }
      break;
    }

    items.push(body);
  }

  const loose = items.some((item) => item.some((line) => !line.trim()));
  const render = (item: string[]) => {
    const nested = item.some((_line, position) => position > 0 && startsBlock(item, position));
    if (!loose && !nested) {
      return renderInline(item.join("\n"), ctx);
    }
    return renderBlocks(item, ctx);
  };

  const tag = ordered ? "ol" : "ul";
  const body = items.map((item) => `<li>${render(item)}</li>`).join("");
  return { html: `<${tag} class="md-list">${body}</${tag}>`, next: index };
}

function renderBlocks(lines: string[], ctx: Context): string {
  let html = "";
  let index = 0;

  while (index < lines.length) {
    const startIndex = index;
    spendStep();
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const marker = fence[2][0];
      const length = fence[2].length;
      const closing = new RegExp(`^ {0,3}${marker === "`" ? "`" : "~"}{${length},}\\s*$`);
      const body: string[] = [];
      index++;
      while (index < lines.length && !closing.test(lines[index])) {
        body.push(lines[index]);
        index++;
      }
      index++; // 吃掉收尾的圍籬（沒有收尾時就是檔案結尾）

      const language = /^[a-zA-Z0-9+#._-]+/.exec(fence[3].trim())?.[0];
      const className = language ? ` class="language-${language.toLocaleLowerCase()}"` : "";
      html += `<pre class="md-pre"><code${className}>${escapeHtml(body.join("\n"))}</code></pre>`;
      continue;
    }

    if (HORIZONTAL_RULE.test(line)) {
      html += "<hr>";
      index++;
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading) {
      html += renderHeading(heading[1].length, heading[2], ctx);
      index++;
      continue;
    }

    if (BLOCK_QUOTE.test(line)) {
      const inner: string[] = [];
      while (index < lines.length) {
        if (BLOCK_QUOTE.test(lines[index])) {
          inner.push(lines[index].replace(/^ {0,3}> ?/, ""));
          index++;
          continue;
        }
        if (!lines[index].trim() && inner.length && BLOCK_QUOTE.test(lines[index + 1] ?? "")) {
          inner.push("");
          index++;
          continue;
        }
        break;
      }
      html += `<blockquote class="md-quote">${renderBlocks(inner, ctx)}</blockquote>`;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const list = renderList(lines, index, ctx);
      html += list.html;
      index = list.next;
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = renderTable(lines, index, ctx);
      html += table.html;
      index = table.next;
      continue;
    }

    // Setext 標題：這一行是文字，下一行是 === 或 ---。
    if ((lines[index + 1] ?? "").match(SETEXT_H1) || (lines[index + 1] ?? "").match(SETEXT_H2)) {
      const level = SETEXT_H1.test(lines[index + 1]) ? 1 : 2;
      html += renderHeading(level, line, ctx);
      index += 2;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && !startsBlock(lines, index)) {
      paragraph.push(lines[index].trim());
      index++;
    }
    if (paragraph.length) {
      html += `<p>${renderInline(paragraph.join("\n"), ctx)}</p>`;
    }

    /*
     * 保險：不論哪個分支接手，這個迴圈每一輪都必須往前走。
     * 少了這道防線，一個「沒有前進」的分支就會讓渲染永遠卡住、整個窗格停在空白。
     */
    if (index <= startIndex) {
      html += `<p>${renderInline(line, ctx)}</p>`;
      index = startIndex + 1;
    }
  }

  return html;
}

/**
 * 把 Markdown 原始碼渲染成 HTML，並列出需要另外載入的本機圖片。
 *
 * 任何意外都不該讓檢視器變成一片空白：渲染失敗時退回顯示原始文字，
 * 使用者至少看得到內容，也看得出是哪一份檔案出問題。
 */
export function renderMarkdown(source: string, baseDir: string): RenderedMarkdown {
  const ctx: Context = { baseDir, images: [], headings: [], slugs: new Map() };
  steps = 0;
  stepBudget = Math.max(50_000, source.length * 50);
  try {
    const lines = source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
    const html = renderBlocks(lines, ctx);
    if (html || !source.trim()) {
      return { html, localImages: ctx.images, headings: ctx.headings };
    }
    return {
      html: rawFallback(source, "Markdown 渲染沒有產生內容，以下為原始文字。"),
      localImages: [],
      headings: [],
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      html: rawFallback(source, `Markdown 渲染失敗（${reason}），以下為原始文字。`),
      localImages: [],
      headings: [],
    };
  }
}

function rawFallback(source: string, note: string): string {
  return `<p class="md-warning">${escapeHtml(note)}</p><pre class="md-pre">${escapeHtml(source)}</pre>`;
}
