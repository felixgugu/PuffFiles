//! 檢視器指令：把檔案內容分批串流回前端。

use crate::commands::fs::run_blocking;
use crate::core;
use crate::error::AppResult;
use crate::model::ViewerEvent;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::ipc::Channel;

/// 讀取單一檔案給檢視器使用。
///
/// 由副檔名決定讀法：後端認得的圖片格式走二進位（base64 分塊），其餘一律當文字讀
/// 並偵測編碼。前端只會對支援的檔案呼叫這個命令。
#[tauri::command]
pub async fn read_viewer_file(path: String, on_event: Channel<ViewerEvent>) -> AppResult<()> {
    let target = PathBuf::from(&path);

    if core::viewer::image_mime(&target).is_some() {
        let file = run_blocking(move || core::viewer::read_image(Path::new(&path))).await?;
        send(
            &on_event,
            ViewerEvent::Start {
                path: file.path.clone(),
                name: file.name.clone(),
                size: file.size,
                modified_ms: file.modified_ms,
                encoding: None,
                mime: Some(file.mime.to_string()),
            },
        )?;

        for chunk in core::viewer::base64_chunks(&file.bytes) {
            send(
                &on_event,
                ViewerEvent::Chunk {
                    text: None,
                    base64: Some(chunk),
                },
            )?;
            yield_now().await;
        }
    } else {
        let file = run_blocking(move || core::viewer::read_text(Path::new(&path))).await?;
        send(
            &on_event,
            ViewerEvent::Start {
                path: file.path.clone(),
                name: file.name.clone(),
                size: file.size,
                modified_ms: file.modified_ms,
                encoding: Some(file.encoding.to_string()),
                mime: None,
            },
        )?;

        for chunk in core::viewer::text_chunks(&file.text) {
            send(
                &on_event,
                ViewerEvent::Chunk {
                    text: Some(chunk.to_string()),
                    base64: None,
                },
            )?;
            yield_now().await;
        }
    }

    send(&on_event, ViewerEvent::Done)
}

fn send(channel: &Channel<ViewerEvent>, event: ViewerEvent) -> AppResult<()> {
    channel.send(event).map_err(|error| crate::AppError::Io {
        message: format!("串流通道中斷：{error}"),
    })
}

/// 讓出執行權，避免連續批次把非同步執行器佔滿。
async fn yield_now() {
    tokio::time::sleep(Duration::ZERO).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ViewerEvent;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_millis();
        let root = std::env::temp_dir().join(format!("pufffile-viewer-cmd-{name}-{stamp}"));
        std::fs::create_dir_all(&root).expect("create scratch");
        root
    }

    /// 用真的 Channel 跑完整指令，並把前端會收到的 JSON 收集起來。
    fn collect(path: &str) -> Vec<serde_json::Value> {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let channel = Channel::<ViewerEvent>::new(move |body| {
            let json = match body {
                tauri::ipc::InvokeResponseBody::Json(text) => text,
                tauri::ipc::InvokeResponseBody::Raw(bytes) => {
                    String::from_utf8_lossy(&bytes).into_owned()
                }
            };
            sink.lock()
                .unwrap()
                .push(serde_json::from_str::<serde_json::Value>(&json).unwrap());
            Ok(())
        });

        tauri::async_runtime::block_on(read_viewer_file(path.to_string(), channel))
            .expect("read viewer file");
        let collected = events.lock().unwrap().clone();
        collected
    }

    #[test]
    fn streams_markdown_text_in_order() {
        let root = scratch("markdown");
        let file = root.join("note.md");
        std::fs::write(&file, "# 標題\n\n段落\n").expect("write");

        let events = collect(&file.to_string_lossy());
        let types: Vec<&str> = events
            .iter()
            .map(|event| event["type"].as_str().unwrap_or(""))
            .collect();
        assert_eq!(types, ["start", "chunk", "done"]);

        let start = &events[0];
        assert_eq!(start["name"], "note.md");
        assert_eq!(start["encoding"], "UTF-8");
        assert!(start["mime"].is_null());

        let text = events[1]["text"].as_str().expect("text chunk");
        assert_eq!(text, "# 標題\n\n段落\n");
        assert!(events[1]["base64"].is_null());
    }

    #[test]
    fn streams_image_as_base64_chunks() {
        let root = scratch("image");
        let file = root.join("pixel.png");
        std::fs::write(&file, [0x89, 0x50, 0x4E, 0x47, 1, 2, 3]).expect("write");

        let events = collect(&file.to_string_lossy());
        assert_eq!(events[0]["mime"], "image/png");
        assert!(events[0]["encoding"].is_null());
        assert_eq!(events[1]["base64"], "iVBORwECAw==");
        assert_eq!(events[2]["type"], "done");
    }

    #[test]
    fn reports_missing_files() {
        let root = scratch("missing");
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let channel = Channel::<ViewerEvent>::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                sink.lock().unwrap().push(text);
            }
            Ok(())
        });

        let result = tauri::async_runtime::block_on(read_viewer_file(
            root.join("nope.md").to_string_lossy().into_owned(),
            channel,
        ));
        assert!(matches!(result, Err(crate::AppError::NotFound { .. })));
        assert!(events.lock().unwrap().is_empty(), "錯誤不該先送事件");
    }
}
