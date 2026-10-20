use crate::core::{
    error::{ErrorCode, ReaderError},
    library,
    reader::{Book, Reader},
};
use serde::Serialize;
use std::sync::Arc;
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDto {
    code: &'static str,
    message: &'static str,
}
impl From<ReaderError> for ErrorDto {
    fn from(error: ReaderError) -> Self {
        if !matches!(error.code, ErrorCode::SessionExpired | ErrorCode::Busy) {
            eprintln!("Reader: {error}");
        }
        Self {
            code: error.code.as_str(),
            message: error.code.message(),
        }
    }
}
pub type CommandResult<T> = Result<T, ErrorDto>;

pub(crate) fn allowed_origin(origin: &str) -> bool {
    matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) || (cfg!(debug_assertions) && origin == "http://127.0.0.1:1420")
}
pub(crate) fn authorize(window: &WebviewWindow) -> CommandResult<()> {
    let origin_ok = window.url().is_ok_and(|url| {
        allowed_origin(&url.origin().ascii_serialization())
            || (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
    });
    if window.label() == "main" && origin_ok {
        Ok(())
    } else {
        Err(ReaderError::new(ErrorCode::Forbidden, "window or origin rejected").into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDto {
    id: String,
    title: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDto {
    id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDto {
    session_id: String,
    title: String,
    pages: Vec<PageDto>,
}
impl From<Book> for SessionDto {
    fn from(book: Book) -> Self {
        Self {
            session_id: book.session_id,
            title: book.title,
            pages: book.pages.into_iter().map(|id| PageDto { id }).collect(),
        }
    }
}
#[tauri::command]
pub fn list_books(window: WebviewWindow) -> CommandResult<Vec<BookDto>> {
    authorize(&window)?;
    Ok(library::list_books()
        .into_iter()
        .map(|book| BookDto {
            id: book.id,
            title: book.title,
        })
        .collect())
}
#[tauri::command]
pub fn begin_open(window: WebviewWindow, reader: State<'_, Arc<Reader>>) -> CommandResult<String> {
    authorize(&window)?;
    reader.begin_open().map_err(Into::into)
}
#[tauri::command]
pub async fn open_selected(
    window: WebviewWindow,
    reader: State<'_, Arc<Reader>>,
    operation_id: String,
) -> CommandResult<Option<SessionDto>> {
    authorize(&window)?;
    // Claim before spawning, so a caller cannot enqueue unbounded blocking jobs.
    let work = reader.inner().start_open(&operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        if !work.is_current() {
            return Err(ReaderError::new(
                ErrorCode::SessionExpired,
                "cancelled before picker",
            ));
        }
        let selected = window
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("Comic archive", &["cbz"])
            .blocking_pick_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        if !work.is_current() {
            return Err(ReaderError::new(
                ErrorCode::SessionExpired,
                "cancelled picker",
            ));
        }
        let path = selected
            .into_path()
            .map_err(|e| ReaderError::new(ErrorCode::ReadFailed, e.to_string()))?;
        work.open(&path).map(|book| Some(book.into()))
    })
    .await
    .map_err(|e| ErrorDto::from(ReaderError::new(ErrorCode::ReadFailed, e.to_string())))?
    .map_err(Into::into)
}
#[tauri::command]
pub fn cancel_open(
    window: WebviewWindow,
    reader: State<'_, Arc<Reader>>,
    operation_id: String,
) -> CommandResult<()> {
    authorize(&window)?;
    reader.cancel_open(&operation_id).map_err(Into::into)
}
#[tauri::command]
pub fn close_book(
    window: WebviewWindow,
    reader: State<'_, Arc<Reader>>,
    session_id: String,
) -> CommandResult<()> {
    authorize(&window)?;
    reader.close(&session_id).map_err(Into::into)
}
#[tauri::command]
pub fn request_page(
    window: WebviewWindow,
    reader: State<'_, Arc<Reader>>,
    session_id: String,
    page_id: String,
    revision: u64,
) -> CommandResult<String> {
    authorize(&window)?;
    reader
        .request_page(&session_id, &page_id, revision)
        .map_err(Into::into)
}
#[tauri::command]
pub fn release_page(
    window: WebviewWindow,
    reader: State<'_, Arc<Reader>>,
    session_id: String,
    ticket_id: String,
) -> CommandResult<()> {
    authorize(&window)?;
    reader
        .release_page(&session_id, &ticket_id)
        .map_err(Into::into)
}
