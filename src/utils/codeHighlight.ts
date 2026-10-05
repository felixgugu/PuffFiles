import hljs from "highlight.js/lib/common";
import type { LanguageFn } from "highlight.js";
import apache from "highlight.js/lib/languages/apache";
import asciidoc from "highlight.js/lib/languages/asciidoc";
import cmake from "highlight.js/lib/languages/cmake";
import clojure from "highlight.js/lib/languages/clojure";
import coffeescript from "highlight.js/lib/languages/coffeescript";
import dart from "highlight.js/lib/languages/dart";
import delphi from "highlight.js/lib/languages/delphi";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import dos from "highlight.js/lib/languages/dos";
import elixir from "highlight.js/lib/languages/elixir";
import erb from "highlight.js/lib/languages/erb";
import erlang from "highlight.js/lib/languages/erlang";
import fortran from "highlight.js/lib/languages/fortran";
import gherkin from "highlight.js/lib/languages/gherkin";
import glsl from "highlight.js/lib/languages/glsl";
import gradle from "highlight.js/lib/languages/gradle";
import groovy from "highlight.js/lib/languages/groovy";
import haml from "highlight.js/lib/languages/haml";
import handlebars from "highlight.js/lib/languages/handlebars";
import haskell from "highlight.js/lib/languages/haskell";
import http from "highlight.js/lib/languages/http";
import julia from "highlight.js/lib/languages/julia";
import latex from "highlight.js/lib/languages/latex";
import lisp from "highlight.js/lib/languages/lisp";
import matlab from "highlight.js/lib/languages/matlab";
import nginx from "highlight.js/lib/languages/nginx";
import nix from "highlight.js/lib/languages/nix";
import nsis from "highlight.js/lib/languages/nsis";
import powershell from "highlight.js/lib/languages/powershell";
import properties from "highlight.js/lib/languages/properties";
import protobuf from "highlight.js/lib/languages/protobuf";
import qml from "highlight.js/lib/languages/qml";
import scala from "highlight.js/lib/languages/scala";
import scheme from "highlight.js/lib/languages/scheme";
import stylus from "highlight.js/lib/languages/stylus";
import twig from "highlight.js/lib/languages/twig";
import vbscript from "highlight.js/lib/languages/vbscript";
import vim from "highlight.js/lib/languages/vim";
import { fileNameOf } from "@/utils/path";
import { vueLanguage } from "@/utils/vueGrammar";

/**
 * 檢視器的語法高亮。
 *
 * 語言分成兩層：`lib/common`（官方精選 36 種，min 約 124 KB／gzip 42 KB）已含
 * xml／javascript／typescript／python／rust／go／css／sql…，再補上實際會在
 * Windows 專案裡出現的其餘語言。刻意**不**匯入 `highlight.js` 全量（193 種）：
 * 那會是 min 1.2 MB／gzip 404 KB，是本清單的 4 倍以上，而差別只在罕見語言。
 *
 * 不做 lazy import —— 單檔 exe 的 lazy chunk 先前已被列為風險，體積不值得冒。
 */

/**
 * `lib/common` 之外要補的語言。
 *
 * 除了本專案 `fileKind.ts` 會遇到的 PowerShell／bat／cmd／stylus（Vue 的
 * `<style lang="stylus">` 會用到），其餘是開發者資料夾裡常見的設定、建置與腳本語言。
 */
const EXTRA_LANGUAGES: Record<string, LanguageFn> = {
  apache,
  asciidoc,
  cmake,
  clojure,
  coffeescript,
  dart,
  delphi,
  dockerfile,
  dos,
  elixir,
  erb,
  erlang,
  fortran,
  gherkin,
  glsl,
  gradle,
  groovy,
  haml,
  handlebars,
  haskell,
  http,
  julia,
  latex,
  lisp,
  matlab,
  nginx,
  nix,
  nsis,
  powershell,
  properties,
  protobuf,
  qml,
  scala,
  scheme,
  stylus,
  twig,
  vbscript,
  vim,
};

for (const [name, language] of Object.entries(EXTRA_LANGUAGES)) {
  hljs.registerLanguage(name, language);
}

/**
 * 一次最多高亮這麼多 bytes，超過就整份當純文字。
 *
 * highlight.js 是同步 API，跑在主要執行緒上；log 或 minified JS 動輒數 MB，
 * 直接丟進去會讓整個 UI 凍住，所以設上限並讓呼叫端顯示提示。
 */
export const MAX_HIGHLIGHT_BYTES = 1024 * 1024;

// highlight.js 內建沒有 Vue 文法（見 vueGrammar.ts 的來源說明）。
hljs.registerLanguage("vue", vueLanguage);

/**
 * 副檔名 → highlight.js 語言 id。
 *
 * 這張表只覆蓋 `fileKind.ts` 的「程式碼」類；沒有列到的副檔名再交給
 * `hljs.getLanguage()` 試內建別名（`ts`／`jsx`／`rs`／`py`／`sh` 這些 hljs
 * 本來就認得），兩邊都落空就回 `null`，呼叫端維持純文字。
 */
const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  vue: "vue",
  rs: "rust",
  py: "python",
  java: "java",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  go: "go",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  html: "xml",
  htm: "xml",
  css: "css",
  scss: "scss",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  // highlight.js 沒有 toml 文法，ini 至少有註解、字串與 [區段]。
  toml: "ini",
  xml: "xml",
  sql: "sql",
  sh: "bash",
  ps1: "powershell",
  bat: "dos",
  cmd: "dos",
};

/**
 * 由語言標記決定 highlight.js 語言 id（副檔名或 Markdown 圍籬的文字都走這裡）。
 *
 * 先查上面的對照表，再交給 `hljs.getLanguage()` 認內建別名；兩個都落空回 `null`。
 */
export function languageForToken(token: string): string | null {
  const value = token.trim().toLocaleLowerCase();
  if (!value) {
    return null;
  }
  const language = EXTENSION_LANGUAGE[value] ?? value;
  return hljs.getLanguage(language) ? language : null;
}

/** 由路徑決定 highlight.js 語言 id；不是認得的程式碼副檔名時回 `null`。 */
export function languageForPath(path: string): string | null {
  const name = fileNameOf(path);
  const index = name.lastIndexOf(".");
  return index > 0 ? languageForToken(name.slice(index + 1)) : null;
}

/**
 * 把原始碼轉成 highlight.js 的 HTML；沒有語言或高亮失敗時回 `null`。
 *
 * 這裡只做字串進、字串出（hljs 會自己轉義 `<`／`&`），回傳值交給 `v-html`
 * 是安全的；呼叫端仍然要負責大小與世代管理。
 */
export function highlightCode(text: string, language: string | null): string | null {
  if (!language || !hljs.getLanguage(language)) {
    return null;
  }
  try {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
