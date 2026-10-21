use super::{
    error::{ErrorCode as Code, ReaderError as Error, Result},
    limits::Limits,
    sources::{cbz::CbzSource, PageData, PageSource},
};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use uuid::Uuid;

const MAX_PAGE_TICKETS: usize = 3;

pub fn opaque_id() -> String {
    Uuid::new_v4().simple().to_string()
}
fn expired() -> Error {
    Error::new(
        Code::SessionExpired,
        "unknown, closed or superseded identifier",
    )
}
fn busy() -> Error {
    Error::new(Code::Busy, "one operation already in flight")
}

#[derive(Clone, Debug)]
pub struct Book {
    pub session_id: String,
    pub title: String,
    pub pages: Vec<String>,
    pub library_book_id: Option<String>,
    pub initial_page_index: usize,
}
struct Session {
    book: Book,
    source: Mutex<Box<dyn PageSource>>,
    alive: AtomicBool,
}
struct Opening {
    id: String,
    cancelled: Arc<AtomicBool>,
    started: bool,
}
struct Ticket {
    id: String,
    page_index: usize,
    current: Arc<AtomicBool>,
}
#[derive(Default)]
struct State {
    session: Option<Arc<Session>>,
    opening: Option<Opening>,
    tickets: Vec<Ticket>,
    revision: u64,
    progress_revision: u64,
}

// Short state locks only. Disk and decompression work never holds this mutex.
#[derive(Default)]
pub struct Reader {
    state: Mutex<State>,
    reading: Arc<AtomicBool>,
}

impl Reader {
    pub fn begin_open(&self) -> Result<String> {
        let mut state = self.state.lock().map_err(|_| expired())?;
        if state.opening.is_some() {
            return Err(busy());
        }
        let id = opaque_id();
        state.opening = Some(Opening {
            id: id.clone(),
            cancelled: Arc::new(AtomicBool::new(false)),
            started: false,
        });
        Ok(id)
    }
    pub fn start_open(self: &Arc<Self>, id: &str) -> Result<OpenWork> {
        let mut state = self.state.lock().map_err(|_| expired())?;
        let opening = state
            .opening
            .as_mut()
            .filter(|op| op.id == id)
            .ok_or_else(expired)?;
        if opening.started || opening.cancelled.load(Ordering::Acquire) {
            return Err(expired());
        }
        opening.started = true;
        Ok(OpenWork {
            reader: self.clone(),
            id: id.to_owned(),
            cancelled: opening.cancelled.clone(),
        })
    }
    pub fn cancel_open(&self, id: &str) -> Result<()> {
        let mut state = self.state.lock().map_err(|_| expired())?;
        let opening = state
            .opening
            .as_ref()
            .filter(|op| op.id == id)
            .ok_or_else(expired)?;
        opening.cancelled.store(true, Ordering::Release);
        if !opening.started {
            state.opening = None;
        }
        Ok(())
    }
    pub fn close(&self, id: &str) -> Result<()> {
        let mut state = self.state.lock().map_err(|_| expired())?;
        let session = state
            .session
            .as_ref()
            .filter(|s| s.book.session_id == id)
            .ok_or_else(expired)?;
        session.alive.store(false, Ordering::Release);
        state.session = None;
        invalidate_tickets(&mut state);
        Ok(())
    }
    pub fn shutdown(&self) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(session) = state.session.take() {
                session.alive.store(false, Ordering::Release);
            }
            if let Some(opening) = &state.opening {
                opening.cancelled.store(true, Ordering::Release);
            }
            invalidate_tickets(&mut state);
        }
    }
    pub fn request_page(&self, session_id: &str, page_id: &str, revision: u64) -> Result<String> {
        let mut state = self.state.lock().map_err(|_| expired())?;
        let session = state
            .session
            .as_ref()
            .filter(|s| s.book.session_id == session_id)
            .ok_or_else(expired)?;
        let page_index = session
            .book
            .pages
            .iter()
            .position(|p| p == page_id)
            .ok_or_else(|| Error::new(Code::InvalidPage, "page not in this session"))?;
        if revision <= state.revision || revision > 9_007_199_254_740_991 {
            return Err(expired());
        }
        if state.tickets.len() >= MAX_PAGE_TICKETS {
            return Err(busy());
        }
        state.revision = revision;
        let id = opaque_id();
        state.tickets.push(Ticket {
            id: id.clone(),
            page_index,
            current: Arc::new(AtomicBool::new(true)),
        });
        Ok(id)
    }
    // Release is idempotent and scoped to one opaque ticket, never a revision range.
    pub fn release_page(&self, session_id: &str, ticket_id: &str) -> Result<()> {
        let mut state = self.state.lock().map_err(|_| expired())?;
        if !state
            .session
            .as_ref()
            .is_some_and(|s| s.book.session_id == session_id)
        {
            return Err(expired());
        }
        if let Some(index) = state.tickets.iter().position(|t| t.id == ticket_id) {
            state
                .tickets
                .remove(index)
                .current
                .store(false, Ordering::Release);
        }
        Ok(())
    }
    pub fn progress(
        &self,
        session_id: &str,
        index: usize,
        revision: u64,
    ) -> Result<Option<super::library::Progress>> {
        let mut state = self.state.lock().map_err(|_| expired())?;
        let session = state
            .session
            .as_ref()
            .filter(|s| s.book.session_id == session_id)
            .ok_or_else(expired)?;
        if index >= session.book.pages.len() {
            return Err(Error::new(Code::InvalidPage, "progress index"));
        }
        if revision <= state.progress_revision || revision > 9_007_199_254_740_991 {
            return Err(expired());
        }
        let result = session
            .book
            .library_book_id
            .clone()
            .map(|book_id| super::library::Progress {
                book_id,
                index,
                page_count: session.book.pages.len(),
                at: super::library::timestamp(),
            });
        state.progress_revision = revision;
        Ok(result)
    }
    // Admission happens before spawn_blocking: one running read, zero queued reads.
    pub fn prepare_read(&self, session_id: &str, ticket_id: &str) -> Result<ReadWork> {
        let state = self.state.lock().map_err(|_| expired())?;
        let session = state
            .session
            .as_ref()
            .filter(|s| s.book.session_id == session_id)
            .ok_or_else(expired)?;
        let ticket = state
            .tickets
            .iter()
            .find(|t| t.id == ticket_id && t.current.load(Ordering::Acquire))
            .ok_or_else(expired)?;
        self.reading
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| busy())?;
        Ok(ReadWork {
            session: session.clone(),
            page_index: ticket.page_index,
            current: ticket.current.clone(),
            reading: self.reading.clone(),
        })
    }
}
fn invalidate_tickets(state: &mut State) {
    for ticket in state.tickets.drain(..) {
        ticket.current.store(false, Ordering::Release);
    }
}

pub struct OpenWork {
    reader: Arc<Reader>,
    id: String,
    cancelled: Arc<AtomicBool>,
}
impl OpenWork {
    pub fn is_current(&self) -> bool {
        !self.cancelled.load(Ordering::Acquire)
    }
    pub fn open(self, path: &Path) -> Result<Book> {
        let source = CbzSource::open(path, Limits::default(), &|| self.is_current())?;
        let title = path
            .file_stem()
            .map(|s| {
                s.to_string_lossy()
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(256)
                    .collect::<String>()
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Untitled book".into());
        self.commit(Box::new(source), title)
    }
    fn commit(&self, source: Box<dyn PageSource>, title: String) -> Result<Book> {
        self.commit_session(source, title, None, 0, || Ok(()))
    }
    pub fn commit_library(
        &self,
        source: Box<dyn PageSource>,
        title: String,
        id: String,
        index: usize,
        before_commit: impl FnOnce() -> Result<()>,
    ) -> Result<Book> {
        self.commit_session(source, title, Some(id), index, before_commit)
    }
    fn commit_session(
        &self,
        source: Box<dyn PageSource>,
        title: String,
        library_book_id: Option<String>,
        initial_page_index: usize,
        before_commit: impl FnOnce() -> Result<()>,
    ) -> Result<Book> {
        let mut state = self.reader.state.lock().map_err(|_| expired())?;
        if !self.is_current() || !state.opening.as_ref().is_some_and(|op| op.id == self.id) {
            return Err(expired());
        }
        before_commit()?;
        let book = Book {
            session_id: opaque_id(),
            title,
            library_book_id,
            initial_page_index,
            pages: (0..source.page_count()).map(|_| opaque_id()).collect(),
        };
        if let Some(old) = state.session.take() {
            old.alive.store(false, Ordering::Release);
        }
        invalidate_tickets(&mut state);
        state.revision = 0;
        state.progress_revision = 0;
        state.session = Some(Arc::new(Session {
            book: book.clone(),
            source: Mutex::new(source),
            alive: AtomicBool::new(true),
        }));
        Ok(book)
    }
}
impl Drop for OpenWork {
    fn drop(&mut self) {
        if let Ok(mut state) = self.reader.state.lock() {
            if state.opening.as_ref().is_some_and(|op| op.id == self.id) {
                state.opening = None;
            }
        }
    }
}

pub struct ReadWork {
    session: Arc<Session>,
    page_index: usize,
    current: Arc<AtomicBool>,
    reading: Arc<AtomicBool>,
}
impl ReadWork {
    pub fn is_current(&self) -> bool {
        self.session.alive.load(Ordering::Acquire) && self.current.load(Ordering::Acquire)
    }
    pub fn read(&self) -> Result<PageData> {
        if !self.is_current() {
            return Err(expired());
        }
        self.session
            .source
            .lock()
            .map_err(|_| expired())?
            .read_page(self.page_index, &|| self.is_current())
    }
}
impl Drop for ReadWork {
    fn drop(&mut self) {
        self.reading.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests;
