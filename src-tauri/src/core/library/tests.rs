use super::*;
use crate::core::{
    reader::{opaque_id, Reader},
    test_support::{image_bytes, zip, Entry},
};
struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("manga-library-test-{}", opaque_id()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn db(&self) -> PathBuf {
        self.0.join("library.sqlite3")
    }
    fn cbz(&self, pages: usize) -> PathBuf {
        let path = self.0.join("Volume.cbz");
        std::fs::write(
            &path,
            zip(&(0..pages)
                .map(|i| {
                    Entry::new(
                        &format!("page{i}.png"),
                        image_bytes(image::ImageFormat::Png, 2, 3),
                        0,
                    )
                })
                .collect::<Vec<_>>()),
        )
        .unwrap();
        path
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
#[test]
fn migration_reopen_idempotence_future_version_and_corruption() {
    let dir = Directory::new();
    {
        let repo = Repository::open(&dir.db()).unwrap();
        assert!(repo.records().unwrap().is_empty());
        assert_eq!(
            repo.connection
                .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    Repository::open(&dir.db()).unwrap();
    let repo = Repository::open(&dir.db()).unwrap();
    repo.connection
        .pragma_update(None, "user_version", 9)
        .unwrap();
    drop(repo);
    assert_eq!(
        Repository::open(&dir.db()).err().unwrap().code,
        ErrorCode::PersistenceFailed
    );
    let bad = dir.0.join("bad.sqlite3");
    std::fs::write(&bad, b"not a database").unwrap();
    assert_eq!(
        Repository::open(&bad).err().unwrap().code,
        ErrorCode::PersistenceFailed
    );
}
#[test]
fn valid_import_duplicate_invalid_import_and_persistent_reopen() {
    let dir = Directory::new();
    let file = dir.cbz(3);
    let library = Library::open(Ok(dir.db()));
    let bad = dir.0.join("bad.cbz");
    std::fs::write(&bad, b"bad zip").unwrap();
    let results = library
        .import(vec![file.clone(), dir.0.join(".").join("Volume.cbz"), bad])
        .unwrap();
    assert_eq!(
        results.iter().map(|r| r.outcome).collect::<Vec<_>>(),
        ["imported", "duplicate", "failed"]
    );
    let books = library.list().unwrap();
    assert_eq!(books.len(), 1);
    assert_eq!(books[0].status, "unread");
    assert_eq!(books[0].page_count, 3);
    let id = books[0].id.clone();
    drop(library);
    let reopened = Library::open(Ok(dir.db()));
    assert_eq!(reopened.list().unwrap()[0].id, id);
    let dto = crate::commands::BookDto::from(reopened.list().unwrap().remove(0));
    let json = serde_json::to_string(&dto).unwrap();
    assert!(!json.contains(&dir.0.to_string_lossy().to_string()));
    assert!(!json.contains("sourceRef"));
    assert!(!json.contains("path"));
}
#[test]
fn missing_restored_and_removed_book_never_deletes_source() {
    let dir = Directory::new();
    let file = dir.cbz(2);
    let library = Library::open(Ok(dir.db()));
    library.import(vec![file.clone()]).unwrap();
    let id = library.list().unwrap()[0].id.clone();
    let moved = dir.0.join("moved.cbz");
    std::fs::rename(&file, &moved).unwrap();
    assert!(!library.list().unwrap()[0].available);
    let reader = Arc::new(Reader::default());
    let op = reader.begin_open().unwrap();
    assert_eq!(
        library
            .open_book(&id, reader.start_open(&op).unwrap())
            .unwrap_err()
            .code,
        ErrorCode::SourceUnavailable
    );
    std::fs::rename(&moved, &file).unwrap();
    assert!(library.list().unwrap()[0].available);
    library.remove(&id).unwrap();
    assert!(file.exists());
    assert!(library.list().unwrap().is_empty());
}
#[test]
fn progress_resume_clamp_completion_and_valid_reader_session() {
    let dir = Directory::new();
    let file = dir.cbz(4);
    let library = Library::open(Ok(dir.db()));
    library.import(vec![file]).unwrap();
    let id = library.list().unwrap()[0].id.clone();
    let reader = Arc::new(Reader::default());
    let op = reader.begin_open().unwrap();
    let book = library
        .open_book(&id, reader.start_open(&op).unwrap())
        .unwrap();
    assert_eq!(book.library_book_id.as_deref(), Some(id.as_str()));
    assert_eq!(book.initial_page_index, 0);
    assert_eq!(library.list().unwrap()[0].status, "reading");
    let ticket = reader
        .request_page(&book.session_id, &book.pages[0], 1)
        .unwrap();
    assert!(reader
        .prepare_read(&book.session_id, &ticket)
        .unwrap()
        .read()
        .is_ok());
    library
        .record(reader.progress(&book.session_id, 2, 1).unwrap().unwrap())
        .unwrap();
    library.flush().unwrap();
    assert!(reader.progress(&book.session_id, 1, 1).is_err());
    assert!(reader.progress(&book.session_id, 99, 2).is_err());
    drop(library);
    let library = Library::open(Ok(dir.db()));
    let op = reader.begin_open().unwrap();
    let resumed = library
        .open_book(&id, reader.start_open(&op).unwrap())
        .unwrap();
    assert_eq!(resumed.initial_page_index, 2);
    library
        .record(reader.progress(&resumed.session_id, 3, 1).unwrap().unwrap())
        .unwrap();
    library.flush().unwrap();
    assert_eq!(library.list().unwrap()[0].status, "completed");
    library
        .record(reader.progress(&resumed.session_id, 1, 2).unwrap().unwrap())
        .unwrap();
    library.flush().unwrap();
    assert_eq!(library.list().unwrap()[0].status, "reading");
    library
        .record(reader.progress(&resumed.session_id, 3, 3).unwrap().unwrap())
        .unwrap();
    library.flush().unwrap();
    dir.cbz(2);
    let op = reader.begin_open().unwrap();
    let smaller = library
        .open_book(&id, reader.start_open(&op).unwrap())
        .unwrap();
    assert_eq!(smaller.initial_page_index, 1);
    assert_eq!(smaller.pages.len(), 2);
    assert!(reader.progress(&resumed.session_id, 1, 4).is_err());
}
#[test]
fn write_failures_are_typed_retryable_and_do_not_replace_reader() {
    let dir = Directory::new();
    let file = dir.cbz(2);
    let library = Library::open(Ok(dir.db()));
    library.import(vec![file]).unwrap();
    let id = library.list().unwrap()[0].id.clone();
    library
        .repository(|r| {
            r.connection
                .pragma_update(None, "query_only", true)
                .map_err(db_error)
        })
        .unwrap();
    library
        .record(Progress {
            book_id: id.clone(),
            index: 1,
            page_count: 2,
            at: timestamp(),
        })
        .unwrap();
    assert_eq!(
        library.flush().unwrap_err().code,
        ErrorCode::PersistenceFailed
    );
    library
        .repository(|r| {
            r.connection
                .pragma_update(None, "query_only", false)
                .map_err(db_error)
        })
        .unwrap();
    library.flush().unwrap();
    assert_eq!(library.list().unwrap()[0].last_page_index, Some(1));
    library.remove(&id).unwrap();
    library
        .record(Progress {
            book_id: id,
            index: 0,
            page_count: 2,
            at: timestamp(),
        })
        .unwrap();
    library.flush().unwrap();
    assert!(library.list().unwrap().is_empty());
}
#[test]
fn bounded_operations_and_unavailable_database_report_errors() {
    let dir = Directory::new();
    let library = Library::open(Ok(dir.0.clone()));
    assert_eq!(
        library.list().unwrap_err().code,
        ErrorCode::PersistenceFailed
    );
    let library = Library::open(Ok(dir.db()));
    let permit = library.admit().unwrap();
    assert!(library.admit().is_err());
    drop(permit);
    assert!(library.admit().is_ok());
    assert_eq!(
        library
            .import(vec![dir.0.join("x.cbz"); 101])
            .err()
            .unwrap()
            .code,
        ErrorCode::LimitExceeded
    );
}
#[test]
fn malformed_record_is_rejected_instead_of_leaking_internal_data() {
    let dir = Directory::new();
    let file = dir.cbz(1);
    let library = Library::open(Ok(dir.db()));
    library.import(vec![file]).unwrap();
    library
        .repository(|r| {
            r.connection
                .execute("UPDATE books SET source_kind='unknown'", [])
                .map_err(db_error)?;
            Ok(())
        })
        .unwrap();
    assert_eq!(
        library.list().unwrap_err().code,
        ErrorCode::PersistenceFailed
    );
}
#[test]
fn shutdown_flushes_the_latest_coalesced_progress() {
    let dir = Directory::new();
    let file = dir.cbz(100);
    let library = Library::open(Ok(dir.db()));
    library.import(vec![file]).unwrap();
    let id = library.list().unwrap()[0].id.clone();
    for index in 0..100 {
        library
            .record(Progress {
                book_id: id.clone(),
                index,
                page_count: 100,
                at: timestamp(),
            })
            .unwrap();
    }
    library.shutdown().unwrap();
    drop(library);
    let reopened = Library::open(Ok(dir.db()));
    let book = reopened.list().unwrap().remove(0);
    assert_eq!(book.last_page_index, Some(99));
    assert_eq!(book.progress_page_count, Some(100));
    assert_eq!(book.status, "completed");
}

#[test]
fn failed_open_metadata_write_and_cancel_preserve_existing_reader() {
    let dir = Directory::new();
    let file = dir.cbz(2);
    let library = Library::open(Ok(dir.db()));
    library.import(vec![file.clone()]).unwrap();
    let id = library.list().unwrap()[0].id.clone();
    let reader = Arc::new(Reader::default());
    let op = reader.begin_open().unwrap();
    let old = reader.start_open(&op).unwrap().open(&file).unwrap();
    library
        .repository(|r| {
            r.connection
                .pragma_update(None, "query_only", true)
                .map_err(db_error)
        })
        .unwrap();
    let op = reader.begin_open().unwrap();
    let error = library
        .open_book(&id, reader.start_open(&op).unwrap())
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::PersistenceFailed);
    assert!(reader
        .request_page(&old.session_id, &old.pages[0], 1)
        .is_ok());
    library
        .repository(|r| {
            r.connection
                .pragma_update(None, "query_only", false)
                .map_err(db_error)
        })
        .unwrap();
    let op = reader.begin_open().unwrap();
    let work = reader.start_open(&op).unwrap();
    reader.cancel_open(&op).unwrap();
    assert_eq!(
        library.open_book(&id, work).unwrap_err().code,
        ErrorCode::SessionExpired
    );
    assert!(library.list().unwrap()[0].last_opened_at.is_none());
}
