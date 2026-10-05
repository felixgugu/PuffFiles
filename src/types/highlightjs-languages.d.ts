/**
 * highlight.js 只附 `types/index.d.ts`、`lib/core.d.ts` 與 `lib/common.d.ts`，
 * 個別語言檔（`lib/languages/*.js`）沒有型別，這裡補上它們的宣告。
 */
declare module "highlight.js/lib/languages/*" {
  import type { LanguageFn } from "highlight.js";

  const language: LanguageFn;
  export default language;
}
