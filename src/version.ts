/**
 * 應用程式版號。
 *
 * 唯一來源是根目錄的 `package.json`，由 Vite 在建置時內嵌；
 * 前端不需要在執行時呼叫任何 Tauri API，瀏覽器開發模式也拿得到值。
 * 發版時記得讓 package.json、src-tauri/Cargo.toml 與 src-tauri/tauri.conf.json 三處一致。
 */
import { version } from "../package.json";

export const APP_VERSION: string = version;
