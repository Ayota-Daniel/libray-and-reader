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
use image::{imageops::FilterType, GenericImageView, ImageFormat};
use progress::ProgressWriter;
use repository::{db_error, Repository};
use std::{
    io::Cursor,
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
    pub completed: bool,
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
    covers_dir: PathBuf,
    cover_busy: Arc<AtomicBool>,
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
    pub fn open(path: Result<PathBuf>, app_data: PathBuf) -> Arc<Self> {
        let repo = Arc::new(Mutex::new(path.and_then(|p| Repository::open(&p))));
        let covers_dir = app_data.join("covers");
        let _ = std::fs::create_dir_all(&covers_dir);
        Arc::new(Self {
            writer: ProgressWriter::new(repo.clone()),
            repo,
            busy: Arc::new(AtomicBool::new(false)),
            covers_dir,
            cover_busy: Arc::new(AtomicBool::new(false)),
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
                    let inserted =
                        self.repository(|r| r.insert(&normalized, &title, source.page_count()))?;
                    if inserted {
                        // Derived cover work is best effort and strictly sequential.
                        let id = self.repository(|r| r.id_for_path(&normalized))?;
                        let _ = self.generate_cover(&id);
                    }
                    Ok(inserted)
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
    #[cfg(test)]
    pub fn cover(&self, id: &str) -> Result<Vec<u8>> {
        validate_id(id)?;
        let permit = self.admit_cover()?;
        self.cover_admitted(id, &permit)
    }
    pub fn admit_cover(&self) -> Result<Permit> {
        self.cover_busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Permit(self.cover_busy.clone()))
            .map_err(|_| ReaderError::new(ErrorCode::Busy, "cover generation in flight"))
    }
    pub fn cover_admitted(&self, id: &str, _permit: &Permit) -> Result<Vec<u8>> {
        validate_id(id)?;
        let record = self.repository(|r| r.get(id))?;
        if let Some(bytes) = self.cached_cover(id, &record.path)? {
            return Ok(bytes);
        }
        self.generate_cover_locked(id, &record.path, &record.book.title)
    }
    fn generate_cover(&self, id: &str) -> Result<Vec<u8>> {
        let _permit = self.admit_cover()?;
        let record = self.repository(|r| r.get(id))?;
        if let Some(bytes) = self.cached_cover(id, &record.path)? {
            return Ok(bytes);
        }
        self.generate_cover_locked(id, &record.path, &record.book.title)
    }
    fn cached_cover(&self, id: &str, source: &Path) -> Result<Option<Vec<u8>>> {
        let (image_path, stamp_path) = self.cover_paths(id)?;
        let Ok(meta) = source.metadata() else {
            let Ok(cover_meta) = image_path.metadata() else {
                return Ok(None);
            };
            if cover_meta.len() > 1024 * 1024 {
                return Ok(None);
            }
            return Ok(std::fs::read(image_path).ok());
        };
        let expected = source_stamp(&meta);
        if std::fs::read(stamp_path).ok().as_deref() != Some(expected.as_slice()) {
            return Ok(None);
        }
        let Ok(bytes) = std::fs::read(image_path) else {
            return Ok(None);
        };
        if bytes.len() > 1024 * 1024 {
            return Ok(None);
        }
        Ok(Some(bytes))
    }
    fn generate_cover_locked(&self, id: &str, source_path: &Path, _title: &str) -> Result<Vec<u8>> {
        let source_meta = std::fs::metadata(source_path)
            .map_err(|e| ReaderError::new(ErrorCode::SourceUnavailable, e.to_string()))?;
        let source_stamp = source_stamp(&source_meta);
        let mut source = CbzSource::open(source_path, Limits::default(), &|| true)?;
        let mut cover = None;
        for index in 0..source.page_count() {
            if let Ok(page) = source.read_page(index, &|| true) {
                let image = image::load_from_memory(&page.bytes)
                    .map_err(|e| ReaderError::new(ErrorCode::CorruptPage, e.to_string()))?;
                let (w, h) = image.dimensions();
                let largest = w.max(h);
                let resized = if largest > 360 {
                    image.resize(
                        ((u64::from(w) * 360 / u64::from(largest)) as u32).max(1),
                        ((u64::from(h) * 360 / u64::from(largest)) as u32).max(1),
                        FilterType::Lanczos3,
                    )
                } else {
                    image
                };
                let mut png = Cursor::new(Vec::new());
                resized
                    .write_to(&mut png, ImageFormat::Png)
                    .map_err(|e| ReaderError::new(ErrorCode::ReadFailed, e.to_string()))?;
                cover = Some(png.into_inner());
                break;
            }
        }
        let bytes = cover
            .ok_or_else(|| ReaderError::new(ErrorCode::CorruptPage, "no decodable cover page"))?;
        let (image_path, stamp_path) = self.cover_paths(id)?;
        atomic_write(&image_path, &bytes)?;
        atomic_write(&stamp_path, &source_stamp)?;
        Ok(bytes)
    }
    fn cover_paths(&self, id: &str) -> Result<(PathBuf, PathBuf)> {
        validate_id(id)?;
        Ok((
            self.covers_dir.join(format!("{id}.png")),
            self.covers_dir.join(format!("{id}.stamp")),
        ))
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

fn validate_id(id: &str) -> Result<()> {
    if id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(ReaderError::new(
            ErrorCode::InvalidPage,
            "cover identifier syntax",
        ))
    }
}
fn source_stamp(meta: &std::fs::Metadata) -> Vec<u8> {
    use std::time::UNIX_EPOCH;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .unwrap_or_default();
    let mut out = Vec::with_capacity(20);
    out.extend_from_slice(&meta.len().to_le_bytes());
    out.extend_from_slice(&modified.as_secs().to_le_bytes());
    out.extend_from_slice(&modified.subsec_nanos().to_le_bytes());
    out
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let temporary = path.with_extension(format!("tmp-{}", crate::core::reader::opaque_id()));
    std::fs::write(&temporary, bytes)
        .map_err(|e| ReaderError::new(ErrorCode::ReadFailed, e.to_string()))?;
    #[cfg(windows)]
    if path.exists() {
        std::fs::remove_file(path)
            .map_err(|e| ReaderError::new(ErrorCode::ReadFailed, e.to_string()))?;
    }
    std::fs::rename(&temporary, path).map_err(|e| {
        let _ = std::fs::remove_file(&temporary);
        ReaderError::new(ErrorCode::ReadFailed, e.to_string())
    })
}

pub fn timestamp() -> i64 {
    repository::now()
}
