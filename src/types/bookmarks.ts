/**
 * 檢視器書籤的資料形狀。
 *
 * 書籤是「這份文件裡的某一段文字」的指標，不是文件內容的一部分 —— 檢視器的內容每次
 * 都是全新的 DOM（`docx-preview` 每排一次版就重建、`v-html` 換檔也整段換掉），
 * 節點參考留不住，所以位置記的是文字本身與它附近的線索，開啟（或重新渲染）之後
 * 再從這些線索把位置對回來（見 `utils/docxBookmark.ts` 與 `utils/textBookmark.ts`）。
 */

/** 書籤的種類，決定位置怎麼記、怎麼對回來。 */
export type BookmarkKind = "docx" | "text";

/** DOCX 的錨點：以「內容區塊」（段落或表格）為單位。 */
export interface DocxBookmarkAnchor {
  kind: "docx";
  /** 選取的文字（原始內容）；區塊指紋對不上時，只用它來搜尋落點。 */
  text: string;
  /** 選取起點在區塊文字裡的位移（UTF-16 code unit）。 */
  offset: number;
  /** 選取文字在區塊裡的長度；對不上時為 0（只跳到區塊，不標示文字）。 */
  length: number;
  /** 所在的內容區塊（段落或表格）在整份文件裡的索引。 */
  blockIndex: number;
  /** 區塊文字的前綴，用來確認「這一個區塊還是同一個」。 */
  blockText: string;
}

/**
 * 純文字／程式碼的錨點：以「整份可見文字的位移」為單位。
 *
 * 這一種內容沒有段落（整份就是一行行的文字），所以位置＝第幾行 ＋ 那一行的內容
 * （指紋）＋ 選取在整份文字裡的位移。行號會因為前面增刪行而位移，所以對位時
 * 一律以「行指紋」為主、行號只用來挑最接近的那一個。
 */
export interface TextBookmarkAnchor {
  kind: "text";
  /** 選取的文字（原始內容）。 */
  text: string;
  /** 選取起點在整份可見文字裡的位移（UTF-16 code unit）。 */
  offset: number;
  /** 選取文字的長度。 */
  length: number;
  /** 選取所在的行號（1 起算），只用來挑最接近的落點。 */
  line: number;
  /** 那一行的內容前綴（指紋）。 */
  lineText: string;
}

/** 書籤在文件裡的位置。 */
export type BookmarkAnchor = DocxBookmarkAnchor | TextBookmarkAnchor;

/** 一份文件裡的一個書籤。 */
export interface DocumentBookmark {
  id: string;
  /** 書籤目錄裡顯示的名稱；預設是選取的文字，可以重新命名。 */
  label: string;
  anchor: BookmarkAnchor;
  createdAt: number;
}
