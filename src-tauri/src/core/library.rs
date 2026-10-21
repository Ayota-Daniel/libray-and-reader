mod progress;
mod repository;
#[cfg(test)]
mod tests;
use crate::core::{
    error::{ErrorCode, ReaderError, Result},
    limits::Limits,
    reader::{Book as SessionBook, OpenWork},
    sources::{cbz::CbzSource, PageSource},
};
use progress::ProgressWriter;
use repository::{db_error, Repository};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

// Safe public metadata. Native references stay in SourceRecord/repository only.
#[derive(Clone, Debug)]
pub struct Book {
    pub id: String,
    pub source_kind: String,
    pub title: String,
    pub page_count: usize,
    pub added_at: i64,
    pub last_opened_at: Option<i64>,
    pub last_page_index: Option<usize>,
    pub progress_page_count: Option<usize>,
    pub last_read_at: Option<i64>,
    pub status: &'static str,
    pub available: bool,
}
struct SourceRecord {
    path: PathBuf,
    book: Book,
}
#[derive(Clone)]
pub struct Progress {
    pub book_id: String,
    pub index: usize,
    pub page_count: usize,
    pub at: i64,
}
pub struct ImportResult {
    pub title: String,
    pub outcome: &'static str,
    pub error: Option<ReaderError>,
}
pub struct Library {
    repo: Arc<Mutex<Result<Repository>>>,
    writer: ProgressWriter,
    busy: Arc<AtomicBool>,
}
pub struct Permit(Arc<AtomicBool>);
impl Drop for Permit {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
pub fn title(path: &Path) -> String {
    path.file_stem()
        .map(|s| {
            s.to_string_lossy()
                .chars()
                .filter(|c| !c.is_control())
                .take(256)
                .collect::<String>()
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Untitled book".into())
}
impl Library {
    pub fn open(path: Result<PathBuf>) -> Arc<Self> {
        let repo = Arc::new(Mutex::new(path.and_then(|p| Repository::open(&p))));
        Arc::new(Self {
            writer: ProgressWriter::new(repo.clone()),
            repo,
            busy: Arc::new(AtomicBool::new(false)),
        })
    }
    pub fn admit(&self) -> Result<Permit> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| ReaderError::new(ErrorCode::Busy, "library operation in flight"))?;
        Ok(Permit(self.busy.clone()))
    }
    fn repository<T>(&self, f: impl FnOnce(&mut Repository) -> Result<T>) -> Result<T> {
        let mut lock = self.repo.lock().map_err(db_error)?;
        let repo = lock
            .as_mut()
            .map_err(|e| ReaderError::new(e.code, "repository unavailable"))?;
        f(repo)
    }
    pub fn list(&self) -> Result<Vec<Book>> {
        self.flush()?;
        let records = self.repository(|r| r.records())?;
        Ok(records
            .into_iter()
            .map(|mut r| {
                r.book.available = r.path.is_file();
                r.book
            })
            .collect())
    }
    pub fn import(&self, paths: Vec<PathBuf>) -> Result<Vec<ImportResult>> {
        if paths.len() > 100 {
            return Err(ReaderError::new(
                ErrorCode::LimitExceeded,
                "maximum 100 imports per selection",
            ));
        }
        self.repository(|_| Ok(()))?;
        Ok(paths
            .into_iter()
            .map(|path| {
                let title = title(&path);
                let result = (|| {
                    let normalized = std::fs::canonicalize(&path).map_err(|e| {
                        ReaderError::new(ErrorCode::SourceUnavailable, e.to_string())
                    })?;
                    // Index/validate outside the database lock; do not decode all pages.
                    let source = CbzSource::open(&normalized, Limits::default(), &|| true)?;
                    self.repository(|r| r.insert(&normalized, &title, source.page_count()))
                })();
                match result {
                    Ok(true) => ImportResult {
                        title,
                        outcome: "imported",
                        error: None,
                    },
                    Ok(false) => ImportResult {
                        title,
                        outcome: "duplicate",
                        error: None,
                    },
                    Err(error) => ImportResult {
                        title,
                        outcome: "failed",
                        error: Some(error),
                    },
                }
            })
            .collect())
    }
    pub fn open_book(&self, id: &str, work: OpenWork) -> Result<SessionBook> {
        self.flush()?;
        let record = self.repository(|r| r.get(id))?;
        if !record.path.is_file() {
            return Err(ReaderError::new(
                ErrorCode::SourceUnavailable,
                "source missing",
            ));
        }
        let source = CbzSource::open(&record.path, Limits::default(), &|| work.is_current())?;
        let count = source.page_count();
        let resume = record.book.last_page_index.unwrap_or(0).min(count - 1);
        if !work.is_current() {
            return Err(ReaderError::new(
                ErrorCode::SessionExpired,
                "cancelled library open",
            ));
        }
        work.commit_library(
            Box::new(source),
            record.book.title,
            id.to_owned(),
            resume,
            || self.repository(|r| r.opened(id, count)),
        )
    }
    pub fn remove(&self, id: &str) -> Result<()> {
        self.flush()?;
        self.repository(|r| r.remove(id))
    }
    pub fn record(&self, progress: Progress) -> Result<()> {
        self.writer.queue(progress)
    }
    pub fn flush(&self) -> Result<()> {
        self.writer.flush()
    }
    pub fn shutdown(&self) -> Result<()> {
        self.writer.shutdown()
    }
}

pub fn timestamp() -> i64 {
    repository::now()
}
