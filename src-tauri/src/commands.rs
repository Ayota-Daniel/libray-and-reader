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
        "tauri://localhost"
            | "http://tauri.localhost"
            | "https://tauri.localhost"
            | "cover://localhost"
            | "http://cover.localhost"
            | "https://cover.localhost"
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
    source_kind: String,
    title: String,
    page_count: usize,
    added_at: i64,
    last_opened_at: Option<i64>,
    last_page_index: Option<usize>,
    progress_page_count: Option<usize>,
    last_read_at: Option<i64>,
    status: &'static str,
    available: bool,
}
impl From<library::Book> for BookDto {
    fn from(b: library::Book) -> Self {
        Self {
            id: b.id,
            source_kind: b.source_kind,
            title: b.title,
            page_count: b.page_count,
            added_at: b.added_at,
            last_opened_at: b.last_opened_at,
            last_page_index: b.last_page_index,
            progress_page_count: b.progress_page_count,
            last_read_at: b.last_read_at,
            status: b.status,
            available: b.available,
        }
    }
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
    library_book_id: Option<String>,
    initial_page_index: usize,
}
impl From<Book> for SessionDto {
    fn from(book: Book) -> Self {
        Self {
            session_id: book.session_id,
            title: book.title,
            library_book_id: book.library_book_id,
            initial_page_index: book.initial_page_index,
            pages: book.pages.into_iter().map(|id| PageDto { id }).collect(),
        }
    }
}
async fn library_job<T: Send + 'static>(
    library: Arc<library::Library>,
    job: impl FnOnce(&library::Library) -> crate::core::error::Result<T> + Send + 'static,
) -> CommandResult<T> {
    let permit = library.admit()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        job(&library)
    })
    .await
    .map_err(|e| {
        ErrorDto::from(ReaderError::new(
            ErrorCode::PersistenceFailed,
            e.to_string(),
        ))
    })?
    .map_err(Into::into)
}
#[tauri::command]
pub async fn list_books(
    window: WebviewWindow,
    library: State<'_, Arc<library::Library>>,
) -> CommandResult<Vec<BookDto>> {
    authorize(&window)?;
    library_job(library.inner().clone(), |l| {
        Ok(l.list()?.into_iter().map(Into::into).collect())
    })
    .await
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDto {
    title: String,
    outcome: &'static str,
    error: Option<ErrorDto>,
}
#[tauri::command]
pub async fn add_books(
    window: WebviewWindow,
    library: State<'_, Arc<library::Library>>,
) -> CommandResult<Vec<ImportDto>> {
    authorize(&window)?;
    library_job(library.inner().clone(), move |l| {
        let selected = window
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("Comic archives", &["cbz"])
            .blocking_pick_files()
            .unwrap_or_default();
        if selected.len() > 100 {
            return Err(ReaderError::new(
                ErrorCode::LimitExceeded,
                "import selection",
            ));
        }
        let paths = selected
            .into_iter()
            .map(|p| {
                p.into_path()
                    .map_err(|e| ReaderError::new(ErrorCode::ReadFailed, e.to_string()))
            })
            .collect::<crate::core::error::Result<Vec<_>>>()?;
        Ok(l.import(paths)?
            .into_iter()
            .map(|r| ImportDto {
                title: r.title,
                outcome: r.outcome,
                error: r.error.map(Into::into),
            })
            .collect())
    })
    .await
}
#[tauri::command]
pub async fn remove_book(
    window: WebviewWindow,
    library: State<'_, Arc<library::Library>>,
    book_id: String,
) -> CommandResult<()> {
    authorize(&window)?;
    library_job(library.inner().clone(), move |l| l.remove(&book_id)).await
}
#[tauri::command]
pub async fn open_library_book(
    window: WebviewWindow,
    reader: State<'_, Arc<Reader>>,
    library: State<'_, Arc<library::Library>>,
    operation_id: String,
    book_id: String,
) -> CommandResult<SessionDto> {
    authorize(&window)?;
    let work = reader.inner().start_open(&operation_id)?;
    library_job(library.inner().clone(), move |l| {
        l.open_book(&book_id, work).map(Into::into)
    })
    .await
}
#[tauri::command]
pub fn record_progress(
    window: WebviewWindow,
    reader: State<'_, Arc<Reader>>,
    library: State<'_, Arc<library::Library>>,
    session_id: String,
    page_index: usize,
    revision: u64,
    last_page_index: Option<usize>,
) -> CommandResult<()> {
    authorize(&window)?;
    if let Some(progress) = reader.progress_range(
        &session_id,
        page_index,
        last_page_index.unwrap_or(page_index),
        revision,
    )? {
        library.record(progress)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn flush_progress(
    window: WebviewWindow,
    library: State<'_, Arc<library::Library>>,
) -> CommandResult<()> {
    authorize(&window)?;
    library_job(library.inner().clone(), |l| l.flush()).await
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
