use super::{Book, Progress, SourceRecord};
use crate::core::{
    error::{ErrorCode, ReaderError, Result},
    reader::opaque_id,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub fn db_error(error: impl std::fmt::Display) -> ReaderError {
    ReaderError::new(ErrorCode::PersistenceFailed, error.to_string())
}
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(9_007_199_254_740_991) as i64
}
#[cfg(unix)]
fn encode(path: &Path) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;
    path.as_os_str().as_bytes().to_vec()
}
#[cfg(unix)]
fn decode(bytes: Vec<u8>) -> Result<PathBuf> {
    use std::os::unix::ffi::OsStringExt;
    Ok(std::ffi::OsString::from_vec(bytes).into())
}
#[cfg(windows)]
fn encode(path: &Path) -> Vec<u8> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .flat_map(u16::to_le_bytes)
        .collect()
}
#[cfg(windows)]
fn decode(bytes: Vec<u8>) -> Result<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    if bytes.len() % 2 != 0 {
        return Err(db_error("invalid path encoding"));
    }
    Ok(std::ffi::OsString::from_wide(
        &bytes
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect::<Vec<_>>(),
    )
    .into())
}
pub struct Repository {
    pub(super) connection: Connection,
}
impl Repository {
    pub fn open(path: &Path) -> Result<Self> {
        let mut connection = Connection::open(path).map_err(db_error)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(2))
            .map_err(db_error)?;
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(db_error)?;
        if !(0..=1).contains(&version) {
            return Err(db_error("unsupported schema version"));
        }
        if version == 0 {
            let transaction = connection.transaction().map_err(db_error)?;
            transaction.execute_batch("CREATE TABLE books (
                id TEXT PRIMARY KEY NOT NULL,
                source_kind TEXT NOT NULL,
                source_ref BLOB NOT NULL,
                title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 256),
                page_count INTEGER NOT NULL CHECK(page_count BETWEEN 1 AND 10000),
                added_at INTEGER NOT NULL CHECK(added_at >= 0),
                opened_at INTEGER,
                progress_index INTEGER CHECK(progress_index >= 0),
                progress_count INTEGER CHECK(progress_count BETWEEN 1 AND 10000),
                read_at INTEGER,
                completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
                UNIQUE(source_kind, source_ref),
                CHECK((progress_index IS NULL AND progress_count IS NULL AND read_at IS NULL) OR
                      (progress_index IS NOT NULL AND progress_count IS NOT NULL AND read_at IS NOT NULL AND progress_index < progress_count))
            ); PRAGMA user_version=1;").map_err(db_error)?;
            transaction.commit().map_err(db_error)?;
        }
        let repo = Self { connection };
        // Verify the expected schema/record types even for an existing version.
        repo.records()?;
        Ok(repo)
    }
    pub fn records(&self) -> Result<Vec<SourceRecord>> {
        let mut query = self.connection.prepare("SELECT id,source_kind,source_ref,title,page_count,added_at,opened_at,progress_index,progress_count,read_at,completed FROM books ORDER BY COALESCE(opened_at,added_at) DESC, id ASC LIMIT 10001").map_err(db_error)?;
        let rows = query
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, u32>(4)? as usize,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, Option<u32>>(7)?.map(|n| n as usize),
                    row.get::<_, Option<u32>>(8)?.map(|n| n as usize),
                    row.get::<_, Option<i64>>(9)?,
                    row.get::<_, bool>(10)?,
                ))
            })
            .map_err(db_error)?;
        let mut result = Vec::new();
        for row in rows {
            let (
                id,
                kind,
                path,
                title,
                count,
                added,
                opened,
                index,
                progress_count,
                read,
                completed,
            ) = row.map_err(db_error)?;
            let valid_id = id.len() == 32
                && id
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase());
            if !valid_id
                || kind != "local_cbz"
                || title.is_empty()
                || title.chars().count() > 256
                || title.chars().any(char::is_control)
                || !(1..=10000).contains(&count)
                || !(0..=9_007_199_254_740_991).contains(&added)
                || opened.is_some_and(|t| !(0..=9_007_199_254_740_991).contains(&t))
                || read.is_some_and(|t| !(0..=9_007_199_254_740_991).contains(&t))
                || index.is_some() != progress_count.is_some()
                || index.is_some() != read.is_some()
                || index
                    .zip(progress_count)
                    .is_some_and(|(i, n)| n == 0 || n > 10000 || i >= n)
            {
                return Err(db_error("invalid library record"));
            }
            let path = decode(path)?;
            if !path.is_absolute() {
                return Err(db_error("invalid native reference"));
            }
            result.push(SourceRecord {
                path,
                book: Book {
                    id,
                    source_kind: kind,
                    title,
                    page_count: count,
                    added_at: added,
                    last_opened_at: opened,
                    last_page_index: index,
                    progress_page_count: progress_count,
                    last_read_at: read,
                    status: if completed {
                        "completed"
                    } else if opened.is_some() {
                        "reading"
                    } else {
                        "unread"
                    },
                    available: false,
                },
            });
        }
        if result.len() > 10000 {
            return Err(db_error("catalog limit"));
        }
        Ok(result)
    }
    pub fn get(&self, id: &str) -> Result<SourceRecord> {
        self.records()?
            .into_iter()
            .find(|r| r.book.id == id)
            .ok_or_else(|| ReaderError::new(ErrorCode::BookNotFound, "library id not found"))
    }
    pub fn insert(&mut self, path: &Path, title: &str, count: usize) -> Result<bool> {
        if self
            .connection
            .query_row(
                "SELECT id FROM books WHERE source_kind='local_cbz' AND source_ref=?",
                [encode(path)],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(db_error)?
            .is_some()
        {
            return Ok(false);
        }
        let tx = self.connection.transaction().map_err(db_error)?;
        let total: i64 = tx
            .query_row("SELECT count(*) FROM books", [], |r| r.get(0))
            .map_err(db_error)?;
        if total >= 10000 {
            return Err(ReaderError::new(ErrorCode::LimitExceeded, "library count"));
        }
        tx.execute("INSERT INTO books(id,source_kind,source_ref,title,page_count,added_at) VALUES(?,'local_cbz',?,?,?,?)", params![opaque_id(),encode(path),title,count as i64,now()]).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(true)
    }
    pub fn id_for_path(&self, path: &Path) -> Result<String> {
        self.connection
            .query_row(
                "SELECT id FROM books WHERE source_kind='local_cbz' AND source_ref=?",
                [encode(path)],
                |r| r.get(0),
            )
            .map_err(db_error)
    }
    pub fn opened(&self, id: &str, count: usize) -> Result<()> {
        let changed = self
            .connection
            .execute(
                "UPDATE books SET opened_at=?, page_count=? WHERE id=?",
                params![now(), count as i64, id],
            )
            .map_err(db_error)?;
        if changed != 1 {
            return Err(ReaderError::new(ErrorCode::BookNotFound, "removed book"));
        }
        Ok(())
    }
    pub fn save(&self, p: &Progress) -> Result<()> {
        if p.page_count == 0 || p.page_count > 10000 || p.index >= p.page_count {
            return Err(db_error("invalid progress"));
        }
        // A removed record is intentionally not resurrected by late progress.
        self.connection.execute("UPDATE books SET progress_index=?,progress_count=?,read_at=?,completed=? WHERE id=?",params![p.index as i64,p.page_count as i64,p.at,p.completed,p.book_id]).map_err(db_error)?;
        Ok(())
    }
    pub fn remove(&self, id: &str) -> Result<()> {
        self.connection
            .execute("DELETE FROM books WHERE id=?", [id])
            .map_err(db_error)?;
        Ok(())
    }
}
