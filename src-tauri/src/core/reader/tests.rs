use super::*;
use std::sync::atomic::AtomicUsize;

struct Source {
    drops: Arc<AtomicUsize>,
}
impl PageSource for Source {
    fn page_count(&self) -> usize {
        2
    }
    fn read_page(&mut self, _: usize, current: &dyn Fn() -> bool) -> Result<PageData> {
        if !current() {
            return Err(expired());
        }
        Ok(PageData {
            bytes: vec![1],
            mime: "image/png",
            width: 1,
            height: 1,
        })
    }
}
impl Drop for Source {
    fn drop(&mut self) {
        self.drops.fetch_add(1, Ordering::SeqCst);
    }
}
fn open(reader: &Arc<Reader>, drops: &Arc<AtomicUsize>) -> Book {
    let id = reader.begin_open().unwrap();
    let work = reader.start_open(&id).unwrap();
    work.commit(
        Box::new(Source {
            drops: drops.clone(),
        }),
        "Test".into(),
    )
    .unwrap()
}
#[test]
fn replacement_invalidates_old_urls_and_releases_handles() {
    let reader = Arc::new(Reader::default());
    let drops = Arc::new(AtomicUsize::new(0));
    let old = open(&reader, &drops);
    let ticket = reader
        .request_page(&old.session_id, &old.pages[0], 1)
        .unwrap();
    let new = open(&reader, &drops);
    assert_ne!(old.session_id, new.session_id);
    assert!(reader.prepare_read(&old.session_id, &ticket).is_err());
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    reader.close(&new.session_id).unwrap();
    assert_eq!(drops.load(Ordering::SeqCst), 2);
}
#[test]
fn cancel_and_failed_replacement_preserve_current_session() {
    let reader = Arc::new(Reader::default());
    let drops = Arc::new(AtomicUsize::new(0));
    let book = open(&reader, &drops);
    let op = reader.begin_open().unwrap();
    let work = reader.start_open(&op).unwrap();
    assert_eq!(reader.begin_open().err().unwrap().code, Code::Busy);
    reader.cancel_open(&op).unwrap();
    assert!(work
        .commit(
            Box::new(Source {
                drops: drops.clone()
            }),
            "Bad".into()
        )
        .is_err());
    drop(work);
    let op = reader.begin_open().unwrap();
    let work = reader.start_open(&op).unwrap();
    assert!(work.open(Path::new("/does-not-exist.cbz")).is_err());
    assert!(reader
        .request_page(&book.session_id, &book.pages[0], 1)
        .is_ok());
}
#[test]
fn single_admission_no_queue_and_close_during_read() {
    let reader = Arc::new(Reader::default());
    let drops = Arc::new(AtomicUsize::new(0));
    let book = open(&reader, &drops);
    let ticket = reader
        .request_page(&book.session_id, &book.pages[0], 1)
        .unwrap();
    let work = reader.prepare_read(&book.session_id, &ticket).unwrap();
    assert_eq!(
        reader
            .prepare_read(&book.session_id, &ticket)
            .err()
            .unwrap()
            .code,
        Code::Busy
    );
    reader.close(&book.session_id).unwrap();
    assert_eq!(drops.load(Ordering::SeqCst), 0); // Only the bounded in-flight worker still owns it.
    assert_eq!(work.read().err().unwrap().code, Code::SessionExpired);
    drop(work);
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    assert!(reader.prepare_read(&book.session_id, &ticket).is_err());
}
#[test]
fn latest_request_wins_even_when_commands_arrive_out_of_order() {
    let reader = Arc::new(Reader::default());
    let drops = Arc::new(AtomicUsize::new(0));
    let book = open(&reader, &drops);
    let first = reader
        .request_page(&book.session_id, &book.pages[0], 1)
        .unwrap();
    let work = reader.prepare_read(&book.session_id, &first).unwrap();
    let newest = reader
        .request_page(&book.session_id, &book.pages[1], 3)
        .unwrap();
    assert!(!work.is_current());
    assert!(reader
        .request_page(&book.session_id, &book.pages[0], 2)
        .is_err());
    reader.release_page(&book.session_id, 2).unwrap();
    drop(work);
    assert!(reader
        .prepare_read(&book.session_id, &newest)
        .unwrap()
        .read()
        .is_ok());
    reader.release_page(&book.session_id, 4).unwrap();
    assert!(reader.prepare_read(&book.session_id, &newest).is_err());
}
#[test]
fn invalid_identifiers_and_shutdown() {
    let reader = Arc::new(Reader::default());
    let drops = Arc::new(AtomicUsize::new(0));
    let book = open(&reader, &drops);
    assert!(reader.close("unknown").is_err());
    assert!(reader.request_page(&book.session_id, "unknown", 1).is_err());
    assert!(reader.request_page("unknown", &book.pages[0], 1).is_err());
    let op = reader.begin_open().unwrap();
    let work = reader.start_open(&op).unwrap();
    reader.shutdown();
    assert!(!work.is_current());
    assert_eq!(drops.load(Ordering::SeqCst), 1);
}

#[test]
fn close_cancels_an_actually_running_worker_without_queueing_another() {
    use std::sync::Barrier;
    struct SlowSource {
        entered: Arc<Barrier>,
        resume: Arc<Barrier>,
    }
    impl PageSource for SlowSource {
        fn page_count(&self) -> usize {
            1
        }
        fn read_page(&mut self, _: usize, current: &dyn Fn() -> bool) -> Result<PageData> {
            self.entered.wait();
            self.resume.wait();
            if !current() {
                return Err(expired());
            }
            panic!("closed worker must observe cancellation");
        }
    }
    let reader = Arc::new(Reader::default());
    let entered = Arc::new(Barrier::new(2));
    let resume = Arc::new(Barrier::new(2));
    let op = reader.begin_open().unwrap();
    let book = reader
        .start_open(&op)
        .unwrap()
        .commit(
            Box::new(SlowSource {
                entered: entered.clone(),
                resume: resume.clone(),
            }),
            "Slow".into(),
        )
        .unwrap();
    let ticket = reader
        .request_page(&book.session_id, &book.pages[0], 1)
        .unwrap();
    let work = reader.prepare_read(&book.session_id, &ticket).unwrap();
    let thread = std::thread::spawn(move || work.read().err().unwrap().code);
    entered.wait();
    assert_eq!(
        reader
            .prepare_read(&book.session_id, &ticket)
            .err()
            .unwrap()
            .code,
        Code::Busy
    );
    reader.close(&book.session_id).unwrap();
    resume.wait();
    assert_eq!(thread.join().unwrap(), Code::SessionExpired);
    assert!(!reader.reading.load(Ordering::Acquire));
}
