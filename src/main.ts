import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "@/assets/styles/main.css";

/*
 * 全域關掉 WebView2／瀏覽器的原生右鍵選單。
 *
 * 應用程式自己的選單（檔案清單、資料夾樹、分頁）都是自繪的，原生那套
 * （上一頁／重新整理／另存新檔／列印／檢查）在這裡只會穿幫。用 capture 攔在
 * 最前面，但只 preventDefault、不 stopPropagation，所以自繪選單照常運作。
 * 輸入框例外：那裡的「剪下／複製／貼上」原生選單仍有用，而且不是瀏覽器那套。
 * 檢視器的內容區（`data-native-menu`）也例外：那裡的文字要能選取複製。
 */
const NATIVE_MENU_ALLOWED = 'input, textarea, [contenteditable="true"], [data-native-menu]';

window.addEventListener(
  "contextmenu",
  (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest(NATIVE_MENU_ALLOWED)) {
      return;
    }
    event.preventDefault();
  },
  { capture: true },
);

createApp(App).use(createPinia()).mount("#app");
