//! 檢視器：把檔案內容讀成可以分批送給前端的形式。
//!
//! 這一層刻意不碰 Tauri：編碼偵測、MIME 對應與切塊都可以獨立測試，
//! 命令層只負責把結果透過 Channel 丟出去。

use crate::core::{display_path, normalize};
use crate::error::{AppError, AppResult};
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// 文字檔一批送出的位元組數；實際切點會再對齊字元邊界。
pub const TEXT_CHUNK_BYTES: usize = 256 * 1024;
/// 圖片一批送出的原始位元組數。必須是 3 的倍數，base64 片段才能直接串接。
pub const IMAGE_CHUNK_BYTES: usize = 192 * 1024;

/// 讀出來的一般文字檔（Markdown 與純文字共用）。
#[derive(Debug)]
pub struct TextFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub encoding: &'static str,
    pub text: String,
}

/// 讀出來的圖片檔。
#[derive(Debug)]
pub struct ImageFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub mime: &'static str,
    pub bytes: Vec<u8>,
}

/// 後端認得的圖片格式。
///
/// 只列 WebView2 真的畫得出來的：`heic`／`tif`／`psd` 之類雖然在清單裡是「影像」，
/// 這裡不當成可檢視，免得使用者只看到破圖。
pub fn image_mime(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" | "jfif" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => return None,
    })
}

/// 讀取文字檔並偵測編碼。
pub fn read_text(path: &Path) -> AppResult<TextFile> {
    let resolved = normalize(path)?;
    let meta = fs::metadata(&resolved).map_err(|error| AppError::from_io(error, &resolved))?;
    if meta.is_dir() {
        return Err(AppError::NotAFile {
            path: display_path(&resolved),
        });
    }

    let bytes = fs::read(&resolved).map_err(|error| AppError::from_io(error, &resolved))?;
    let (text, encoding) = decode_text(&bytes);

    Ok(TextFile {
        path: display_path(&resolved),
        name: file_name(&resolved),
        size: meta.len(),
        modified_ms: modified_ms(&meta),
        encoding,
        text,
    })
}

/// 讀取圖片檔。
pub fn read_image(path: &Path) -> AppResult<ImageFile> {
    let resolved = normalize(path)?;
    let Some(mime) = image_mime(&resolved) else {
        return Err(AppError::Unsupported {
            feature: format!(
                "這種圖片格式（{}）",
                resolved
                    .extension()
                    .map(|value| value.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "沒有副檔名".to_string())
            ),
        });
    };

    let meta = fs::metadata(&resolved).map_err(|error| AppError::from_io(error, &resolved))?;
    if meta.is_dir() {
        return Err(AppError::NotAFile {
            path: display_path(&resolved),
        });
    }

    let bytes = fs::read(&resolved).map_err(|error| AppError::from_io(error, &resolved))?;

    Ok(ImageFile {
        path: display_path(&resolved),
        name: file_name(&resolved),
        size: meta.len(),
        modified_ms: modified_ms(&meta),
        mime,
        bytes,
    })
}

/// 把位元組解成字串，並回報實際使用的編碼。
///
/// 順序：BOM → UTF-8 → Big5 與 GBK 取取代字元較少的那個 → 最後才 lossy UTF-8。
/// 台灣的舊筆記常見 Big5，先試它符合這個產品的實際使用情境。
pub fn decode_text(bytes: &[u8]) -> (String, &'static str) {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return (String::from_utf8_lossy(rest).into_owned(), "UTF-8");
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        let (text, _, _) = encoding_rs::UTF_16LE.decode(rest);
        return (text.into_owned(), "UTF-16LE");
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let (text, _, _) = encoding_rs::UTF_16BE.decode(rest);
        return (text.into_owned(), "UTF-16BE");
    }
    // 沒有 BOM 的 UTF-16（少數編輯器會這樣存）：字元之間會夾大量 NUL，
    // 先用這個特徵認出來，否則 NUL 是合法 UTF-8，會被當成含控制字元的純文字。
    if let Some(encoding) = utf16_without_bom(bytes) {
        let (text, _, _) = encoding.decode(bytes);
        return (text.into_owned(), encoding.name());
    }

    if let Ok(text) = std::str::from_utf8(bytes) {
        return (text.to_string(), "UTF-8");
    }

    let (big5, _, big5_errors) = encoding_rs::BIG5.decode(bytes);
    let (gbk, _, gbk_errors) = encoding_rs::GBK.decode(bytes);
    if gbk_errors && !big5_errors {
        (gbk.into_owned(), "GBK")
    } else {
        (big5.into_owned(), "Big5")
    }
}

/// 由 NUL 的分佈猜測沒有 BOM 的 UTF-16；猜不出來時回 `None`。
fn utf16_without_bom(bytes: &[u8]) -> Option<&'static encoding_rs::Encoding> {
    if bytes.len() < 4 {
        return None;
    }
    let even_nuls = bytes.iter().step_by(2).filter(|byte| **byte == 0).count();
    let odd_nuls = bytes
        .iter()
        .skip(1)
        .step_by(2)
        .filter(|byte| **byte == 0)
        .count();
    let pairs = bytes.len() / 2;

    // 一般的拉丁或中文 UTF-16 文字會讓其中一個半邊幾乎都是 NUL。
    if odd_nuls * 2 >= pairs && even_nuls * 4 <= pairs {
        return Some(encoding_rs::UTF_16LE);
    }
    if even_nuls * 2 >= pairs && odd_nuls * 4 <= pairs {
        return Some(encoding_rs::UTF_16BE);
    }
    None
}

/// 依字元邊界把字串切成一批批（回傳的是切片，不會複製內容）。
pub fn text_chunks(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut start = 0usize;
    for (index, _) in text.char_indices() {
        if index > start && index - start >= TEXT_CHUNK_BYTES {
            chunks.push(&text[start..index]);
            start = index;
        }
    }
    if start < text.len() {
        chunks.push(&text[start..]);
    }
    chunks
}

/// 把圖片切成 base64 片段。
///
/// 每塊都是 3 的倍數，所以「片段串接」等於「整份 base64」，前端不需要知道邊界。
pub fn base64_chunks(bytes: &[u8]) -> Vec<String> {
    bytes.chunks(IMAGE_CHUNK_BYTES).map(encode_base64).collect()
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// 標準 base64 編碼（含 `=` 補齊）。自帶實作，少一個相依套件。
pub fn encode_base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0] as u32;
        let second = *chunk.get(1).unwrap_or(&0) as u32;
        let third = *chunk.get(2).unwrap_or(&0) as u32;
        let packed = (first << 16) | (second << 8) | third;

        out.push(BASE64_ALPHABET[(packed >> 18) as usize & 63] as char);
        out.push(BASE64_ALPHABET[(packed >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            BASE64_ALPHABET[(packed >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            BASE64_ALPHABET[packed as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| display_path(path))
}

fn modified_ms(meta: &fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_millis();
        let root = std::env::temp_dir().join(format!("pufffile-viewer-{name}-{stamp}"));
        std::fs::create_dir_all(&root).expect("create scratch");
        root
    }

    #[test]
    fn decodes_utf8_and_strips_bom() {
        let (text, encoding) = decode_text("哈囉".as_bytes());
        assert_eq!((text.as_str(), encoding), ("哈囉", "UTF-8"));

        let mut with_bom = vec![0xEF, 0xBB, 0xBF];
        with_bom.extend_from_slice("哈囉".as_bytes());
        let (text, encoding) = decode_text(&with_bom);
        assert_eq!((text.as_str(), encoding), ("哈囉", "UTF-8"));
    }

    #[test]
    fn falls_back_to_big5_for_non_utf8_bytes() {
        let (encoded, _, _) = encoding_rs::BIG5.encode("中文筆記");
        assert!(
            std::str::from_utf8(&encoded).is_err(),
            "測試資料必須不是合法 UTF-8"
        );

        let (text, encoding) = decode_text(&encoded);
        assert_eq!(text, "中文筆記");
        assert_eq!(encoding, "Big5");
    }

    #[test]
    fn decodes_utf16_with_bom() {
        // 明確組出帶 BOM 的 UTF-16LE 與 UTF-16BE 位元組，不依賴套件的編碼輸出行為。
        let le = [0xFF, 0xFE, b'n', 0, b'o', 0, b't', 0, b'e', 0];
        assert_eq!(decode_text(&le), ("note".to_string(), "UTF-16LE"));

        let be = [0xFE, 0xFF, 0, b'n', 0, b'o', 0, b't', 0, b'e'];
        assert_eq!(decode_text(&be), ("note".to_string(), "UTF-16BE"));
    }

    #[test]
    fn detects_utf16_without_bom() {
        let le = [b'n', 0, b'o', 0, b't', 0, b'e', 0];
        assert_eq!(decode_text(&le), ("note".to_string(), "UTF-16LE"));

        let be = [0, b'n', 0, b'o', 0, b't', 0, b'e'];
        assert_eq!(decode_text(&be), ("note".to_string(), "UTF-16BE"));
    }

    #[test]
    fn text_chunks_never_split_a_character() {
        // 讓內容明顯超過一個批次，確認每一塊自己就是合法 UTF-8。
        let text = "中文筆記".repeat(TEXT_CHUNK_BYTES);
        let chunks = text_chunks(&text);
        assert!(chunks.len() > 1, "應該切成多塊");
        assert_eq!(chunks.concat(), text);
        for chunk in &chunks {
            assert!(chunk.len() <= TEXT_CHUNK_BYTES + 3, "單塊不該超出上限太多");
            assert!(std::str::from_utf8(chunk.as_bytes()).is_ok());
        }
    }

    #[test]
    fn base64_chunks_concatenate_to_the_whole_encoding() {
        let bytes: Vec<u8> = (0..IMAGE_CHUNK_BYTES * 2 + 7)
            .map(|i| (i % 251) as u8)
            .collect();
        let joined = base64_chunks(&bytes).concat();
        assert_eq!(joined, encode_base64(&bytes));
        assert!(joined.ends_with('='));
    }

    #[test]
    fn image_mime_maps_known_extensions_only() {
        assert_eq!(image_mime(Path::new("a.PNG")), Some("image/png"));
        assert_eq!(image_mime(Path::new("a.jpeg")), Some("image/jpeg"));
        assert_eq!(image_mime(Path::new("a.svg")), Some("image/svg+xml"));
        assert_eq!(image_mime(Path::new("a.psd")), None);
        assert_eq!(image_mime(Path::new("a")), None);
    }

    #[test]
    fn reads_a_text_file_and_reports_errors() {
        let root = scratch("read");
        let file = root.join("note.md");
        fs::write(&file, "# 標題\n").expect("write");

        let text = read_text(&file).expect("read text");
        assert_eq!(text.name, "note.md");
        assert_eq!(text.encoding, "UTF-8");
        assert_eq!(text.text, "# 標題\n");
        assert_eq!(text.size, 9);

        assert!(matches!(read_text(&root), Err(AppError::NotAFile { .. })));
        assert!(matches!(
            read_text(&root.join("missing.md")),
            Err(AppError::NotFound { .. })
        ));
    }

    #[test]
    fn rejects_unsupported_image_extensions() {
        let root = scratch("image");
        let file = root.join("photo.psd");
        fs::write(&file, b"not an image").expect("write");
        assert!(matches!(
            read_image(&file),
            Err(AppError::Unsupported { .. })
        ));
    }
}
