//! 檔案串流協定：把磁碟上的檔案直接餵給 WebView，支援 HTTP Range。
//!
//! 這是 PDF 檢視器（iframe 直接讀）與 DOCX 檢視器（`fetch` 取整份位元組）的來源。
//! 相對「整份讀成 base64 → Blob URL」那條路，這裡只在使用者真的需要某一段時讀那一段
//! （Chromium 的 PDF viewer 會自己發 Range 請求），所以峰值記憶體是「單次區段」而不是
//! 「檔案的 2.3 倍」。
//!
//! 存取權不是路徑而是**不可猜的 token**：`open_file_stream` 產生一組、前端放進 iframe
//! 的 URL，`close_file_stream` 立刻撤銷。URL 本身不含路徑，也不會在關閉後繼續有效。

use crate::core::stream::{self, RangeOutcome};
use crate::error::{AppError, AppResult};
use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{Manager, Runtime, State, UriSchemeContext, UriSchemeResponder};

/// 協定名稱。Windows 上的 URL 是 `http://stream.localhost/<token>`，
/// 其他平台是 `stream://localhost/<token>`（前端用 `convertFileSrc` 產生，不必自己判斷）。
pub const SCHEME: &str = "stream";

/// 目前開啟中的串流：token → 檔案路徑。每個窗格同時只有一個 token，這張表不會長大。
#[derive(Default)]
pub struct StreamRegistry {
    files: Mutex<HashMap<String, PathBuf>>,
}

impl StreamRegistry {
    /// 取鎖；萬一有執行緒 panic 過也繼續用裡面的資料，不要讓整個應用程式陪葬
    /// （release 是 `panic = "abort"`，這裡更不能 panic）。
    fn files(&self) -> MutexGuard<'_, HashMap<String, PathBuf>> {
        self.files
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lookup(&self, token: &str) -> Option<PathBuf> {
        self.files().get(token).cloned()
    }
}

/// 產生一組不可猜的 token（128-bit hex）。
///
/// 用 `RandomState` 當來源：它的雜湊鍵來自 OS 亂數，且每次建立都不一樣，所以輸出無法
/// 從序號或時間推回來 —— 不必為此新增相依套件。
fn new_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);

    let mut token = String::with_capacity(32);
    for round in 0..2u64 {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u64(round);
        hasher.write_u64(SEQUENCE.fetch_add(1, Ordering::Relaxed));
        hasher.write_u128(nanos);
        token.push_str(&format!("{:016x}", hasher.finish()));
    }
    token
}

/// `open_file_stream` 的回應：token 加上檔案大小（檢視器標頭要顯示，不必再問一次後端）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamHandle {
    pub token: String,
    pub size: u64,
}

/// 開始提供某個檔案的內容，回傳要放進 URL 的 token。
#[tauri::command]
pub fn open_file_stream(
    path: String,
    registry: State<'_, StreamRegistry>,
) -> AppResult<StreamHandle> {
    let resolved = crate::core::normalize(Path::new(&path))?;
    let meta = std::fs::metadata(&resolved).map_err(|error| AppError::from_io(error, &resolved))?;
    if meta.is_dir() {
        return Err(AppError::NotAFile {
            path: resolved.to_string_lossy().into_owned(),
        });
    }

    if !stream::is_streamable(&resolved) {
        return Err(AppError::Unsupported {
            feature: format!(
                "串流「{}」（目前只支援圖片、PDF 與 DOCX）",
                resolved
                    .file_name()
                    .map(|value| value.to_string_lossy().into_owned())
                    .unwrap_or_else(|| resolved.to_string_lossy().into_owned())
            ),
        });
    }

    let token = new_token();
    registry.files().insert(token.clone(), resolved);
    Ok(StreamHandle {
        token,
        size: meta.len(),
    })
}

/// 撤銷 token；之後同一個 URL 一律回 404。
#[tauri::command]
pub fn close_file_stream(token: String, registry: State<'_, StreamRegistry>) -> AppResult<()> {
    registry.files().remove(&token);
    Ok(())
}

/// `stream://` 的處理器：查 token、讀檔、回應。
///
/// 檔案 I/O 丟到背景執行緒（`spawn_blocking`），不阻塞 WebView 的事件迴圈。
pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();

    // token 是路徑的第一段；wry 會把 `http://stream.localhost/<token>` 還原成
    // `stream://localhost/<token>`，所以這裡拿到的 path 就是 `/<token>`。
    let token = request
        .uri()
        .path()
        .trim_start_matches('/')
        .split('/')
        .next()
        .unwrap_or_default()
        .to_string();
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let method = request.method().clone();

    tauri::async_runtime::spawn_blocking(move || {
        if method != Method::GET && method != Method::HEAD {
            responder.respond(plain(StatusCode::METHOD_NOT_ALLOWED, "只支援 GET"));
            return;
        }

        let Some(path) = app.state::<StreamRegistry>().lookup(&token) else {
            responder.respond(plain(StatusCode::NOT_FOUND, "這個串流已經失效"));
            return;
        };

        responder.respond(respond_for_file(
            &path,
            range.as_deref(),
            method == Method::HEAD,
        ));
    });
}

/// 組出回應。刻意抽成不依賴 Tauri 的函式，才能在單元測試裡直接驗狀態碼與內容。
fn respond_for_file(path: &Path, range: Option<&str>, head_only: bool) -> Response<Cow<'static, [u8]>> {
    let meta = match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => meta,
        _ => return plain(StatusCode::NOT_FOUND, "找不到檔案"),
    };
    let total = meta.len();
    let outcome = stream::parse_range(range, total);

    let (start, end, status) = match outcome {
        RangeOutcome::Unsatisfiable => {
            return build(StatusCode::RANGE_NOT_SATISFIABLE, path)
                .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                .body(Vec::new().into())
                .unwrap_or_else(|_| empty(StatusCode::RANGE_NOT_SATISFIABLE));
        }
        RangeOutcome::Partial(range) => (range.start, range.end, StatusCode::PARTIAL_CONTENT),
        RangeOutcome::Whole => (0, total.saturating_sub(1), StatusCode::OK),
    };
    let length = if total == 0 { 0 } else { end - start + 1 };

    let mut response = build(status, path).header(header::CONTENT_LENGTH, length.to_string());
    if status == StatusCode::PARTIAL_CONTENT {
        response = response.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"));
    }
    if head_only {
        // HEAD 帶一樣的標頭、但沒有主體。
        return response.body(Vec::new().into()).unwrap_or_else(|_| empty(status));
    }

    match read_range(path, start, length) {
        Ok(bytes) => response.body(bytes.into()).unwrap_or_else(|_| empty(status)),
        Err(_) => plain(StatusCode::INTERNAL_SERVER_ERROR, "讀取檔案失敗"),
    }
}

/// 共用標頭：型別、可分段、以及「PDF viewer 可能以跨來源子資源取檔」的保險。
fn build(status: StatusCode, path: &Path) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, stream::mime_for(path))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
}

fn read_range(path: &Path, start: u64, length: u64) -> std::io::Result<Vec<u8>> {
    let mut file = std::fs::File::open(path)?;
    if start > 0 {
        file.seek(SeekFrom::Start(start))?;
    }
    let mut buffer = vec![0u8; length as usize];
    file.read_exact(&mut buffer)?;
    Ok(buffer)
}

fn plain(status: StatusCode, message: &str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Cow::Owned(message.as_bytes().to_vec()))
        .unwrap_or_else(|_| empty(status))
}

fn empty(status: StatusCode) -> Response<Cow<'static, [u8]>> {
    let mut response = Response::new(Cow::Borrowed(&[][..]));
    *response.status_mut() = status;
    response
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// 一份 1000 bytes、內容可預測的測試檔。
    ///
    /// 目錄名帶測試名稱與序號：測試是平行跑的，只靠毫秒時間戳會讓兩個測試共用同一個
    /// 目錄，先跑完的那個把檔案刪掉、另一個就找不到檔案。
    fn sample(name: &str) -> (PathBuf, Vec<u8>) {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);

        let root = std::env::temp_dir().join(format!(
            "pufffile-stream-{name}-{}",
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&root).expect("create scratch");

        let bytes: Vec<u8> = (0..1000u32).map(|index| (index % 251) as u8).collect();
        let file = root.join("report.pdf");
        std::fs::write(&file, &bytes).expect("write");
        (file, bytes)
    }

    #[test]
    fn serves_a_partial_range_with_206() {
        let (path, bytes) = sample("partial");
        let response = respond_for_file(&path, Some("bytes=0-99"), false);

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/pdf");
        assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes 0-99/1000");
        assert_eq!(response.headers()[header::ACCEPT_RANGES], "bytes");
        assert_eq!(response.body().as_ref(), &bytes[..100]);

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn serves_the_whole_file_without_a_range_header() {
        let (path, bytes) = sample("whole");
        let response = respond_for_file(&path, None, false);

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().len(), bytes.len());
        assert!(response.headers().get(header::CONTENT_RANGE).is_none());

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn answers_head_without_a_body() {
        let (path, _) = sample("head");
        let response = respond_for_file(&path, None, true);

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_LENGTH], "1000");
        assert!(response.body().is_empty());

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn rejects_unsatisfiable_and_missing_files() {
        let (path, _) = sample("unsatisfiable");
        let response = respond_for_file(&path, Some("bytes=5000-"), false);
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes */1000");

        let missing = respond_for_file(&path.join("nope.pdf"), None, false);
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn tokens_are_unique_and_registry_drops_them_on_close() {
        let first = new_token();
        let second = new_token();
        assert_ne!(first, second, "兩次 token 不該相同");
        assert_eq!(first.len(), 32, "128-bit hex");

        let registry = StreamRegistry::default();
        registry.files().insert(first.clone(), PathBuf::from("C:\\a.pdf"));
        assert!(registry.lookup(&first).is_some());
        registry.files().remove(&first);
        assert!(registry.lookup(&first).is_none());
    }
}
