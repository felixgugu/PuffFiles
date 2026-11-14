/**
 * 壓縮檔檢視器的資料形狀（與 Rust `core::archive` 對應）。
 *
 * 這是**唯讀**清單：只列項目，不解壓縮、不落地。呼叫已安裝的 7-Zip 命令列版
 * （`7z.exe`），所以格式範圍就是 7-Zip 能列出的那些（zip／7z／rar／tar／iso…）。
 */

/** 壓縮檔裡的一個項目（資料夾由前端從路徑合成，後端只回檔案）。 */
export interface ArchiveEntry {
  /** 壓縮檔內的相對路徑，分隔符沿用 7-Zip 的 `\`（前端兩種都接受）。 */
  path: string;
  /** 解壓縮後的大小（bytes）。 */
  size: number;
  /** 壓縮後的大小（bytes）；部分格式沒有這個資訊時是 0。 */
  packedSize: number;
  /** 7-Zip 印出的時間字串（已去掉小數秒）；沒有時是 `null`。 */
  modified: string | null;
  /** 這個項目本身被加密（需要密碼才能解開）。 */
  encrypted: boolean;
  crc: string | null;
}

/** 後端 `list_archive` 的回傳值。 */
export interface ArchiveListing {
  path: string;
  name: string;
  /** 壓縮檔本身的大小（不是內容總和）。 */
  size: number;
  entries: ArchiveEntry[];
  /** 所有項目解壓縮後的大小總和。 */
  totalSize: number;
  /** 所有項目壓縮後的大小總和。 */
  totalPackedSize: number;
  /** 超過上限只回前段。 */
  truncated: boolean;
  /** 有任何項目被加密（檔頭加密會直接列不出來，走 `passwordRequired`）。 */
  encrypted: boolean;
}
