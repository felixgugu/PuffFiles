/**
 * DOCX 檢視器的純函數。
 *
 * 排版本身交給 docx-preview（`DocxView.vue`），這裡只放「與 DOM 無關、可以單獨想清楚」
 * 的算術與掃描：看得出來的行為都在這兩個函式裡。
 */

/** 縮放下限：再小也沒有閱讀價值，寧可讓它出現水平捲軸。 */
const MIN_ZOOM = 0.25;

/**
 * 頁面要塞進可用寬度時該縮到幾倍。
 *
 * 頁面比窗格窄就維持 1（**不放大** —— 100% 才是 Word 的原尺寸），比窗格寬才等比例縮小；
 * 量不到寬度時一律回 1，寧可出現水平捲軸也不要縮成奇怪的尺寸。
 */
export function docxZoom(availableWidth: number, pageWidth: number): number {
  if (!(availableWidth > 0) || !(pageWidth > 0)) {
    return 1;
  }
  return Math.max(MIN_ZOOM, Math.min(1, availableWidth / pageWidth));
}

/** 掃描用的屬性：這些元素的來源可能是指向 blob 的 URL。 */
const SOURCE_ATTRIBUTES = ["src", "data", "poster"] as const;

/**
 * 掃出容器裡所有 blob URL（圖片與嵌入字型）。
 *
 * docx-preview 用 `URL.createObjectURL` 產生圖片與字型的來源，但**從來不撤銷**：
 * 每排一次版就多留下一批參考不到的 blob。換下一份文件前先把上一份的還回去，
 * 連續預覽才不會一份一份堆積記憶體。
 */
export function collectBlobUrls(root: HTMLElement): string[] {
  const found = new Set<string>();
  const add = (value: string | null) => {
    if (value?.startsWith("blob:")) {
      found.add(value);
    }
  };

  for (const element of root.querySelectorAll<HTMLElement>("img, source, video, audio, input")) {
    for (const attribute of SOURCE_ATTRIBUTES) {
      add(element.getAttribute(attribute));
    }
  }
  // 嵌入字型只出現在 docx-preview 注入的 <style> 文字裡（`@font-face`）。
  for (const style of root.querySelectorAll("style")) {
    for (const match of (style.textContent ?? "").matchAll(/blob:[^"'\s)]+/g)) {
      found.add(match[0]);
    }
  }
  return [...found];
}
