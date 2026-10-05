import type { LanguageFn } from "highlight.js";

/**
 * Vue 單檔元件的 highlight.js 文法。
 *
 * 改寫自 `highlightjs-vue@1.0.0`（作者 Sara Lissette Luis Ibáñez，CC0-1.0）——
 * 該套件發佈到 npm 的 `dist` 被 build 弄壞了（`require()` 只拿到空物件），
 * 因此這裡直接內嵌同一份文法，並補上現代 SFC 一定會用到的
 * `<script setup lang="ts">` 形式。CC0 沒有姓名標示義務，這裡保留出處只是為了可追溯。
 *
 * 主體交給 `xml`，再把 `<script>`／`<style>` 區塊換成對應的子語言；因為
 * `codeHighlight.ts` 註冊的是 highlight.js 全量版本，用到的
 * javascript／typescript／css／scss／stylus 都一定在。
 */
export const vueLanguage: LanguageFn = (hljs) => ({
  subLanguage: "xml",
  contains: [
    hljs.COMMENT("<!--", "-->", { relevance: 10 }),
    {
      // 沒有 lang 屬性的 `<script>`（含 `<script setup>`）。
      begin: /^(\s*)(<script(?![^>]*\blang=)[^>]*>)/gm,
      end: /^(\s*)(<\/script>)/gm,
      subLanguage: "javascript",
      excludeBegin: true,
      excludeEnd: true,
    },
    {
      begin: /^(\s*)(<script[^>]*\blang=["']tsx?["'][^>]*>)/gm,
      end: /^(\s*)(<\/script>)/gm,
      subLanguage: "typescript",
      excludeBegin: true,
      excludeEnd: true,
    },
    {
      begin: /^(\s*)(<style(\sscoped)?>)/gm,
      end: /^(\s*)(<\/style>)/gm,
      subLanguage: "css",
      excludeBegin: true,
      excludeEnd: true,
    },
    {
      begin: /^(\s*)(<style lang=["'](scss|sass)["'](\sscoped)?>)/gm,
      end: /^(\s*)(<\/style>)/gm,
      subLanguage: "scss",
      excludeBegin: true,
      excludeEnd: true,
    },
    {
      begin: /^(\s*)(<style lang=["']stylus["'](\sscoped)?>)/gm,
      end: /^(\s*)(<\/style>)/gm,
      subLanguage: "stylus",
      excludeBegin: true,
      excludeEnd: true,
    },
  ],
});
