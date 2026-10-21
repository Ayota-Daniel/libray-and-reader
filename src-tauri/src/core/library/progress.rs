use super::{
    repository::{db_error, Repository},
    Progress,
};
use crate::core::error::{ErrorCode, ReaderError, Result};
use std::sync::{Arc, Condvar, Mutex};
#[derive(Default)]
struct Queue {
    pending: Option<Progress>,
    writing: Option<String>,
    error: Option<ErrorCode>,
    stop: bool,
}
pub(super) struct ProgressWriter {
    queue: Arc<(Mutex<Queue>, Condvar)>,
    thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}
impl ProgressWriter {
    pub fn new(repo: Arc<Mutex<Result<Repository>>>) -> Self {
        let queue = Arc::new((Mutex::new(Queue::default()), Condvar::new()));
        let worker = queue.clone();
        let thread = std::thread::spawn(move || {
            let (lock, wake) = &*worker;
            loop {
                let mut state = lock.lock().unwrap_or_else(|p| p.into_inner());
                while !state.stop && (state.pending.is_none() || state.error.is_some()) {
                    state = wake.wait(state).unwrap_or_else(|p| p.into_inner());
                }
                if state.stop {
                    break;
                }
                let progress = state.pending.take().expect("pending progress");
                state.writing = Some(progress.book_id.clone());
                drop(state);
                let result = (|| {
                    let guard = repo.lock().map_err(db_error)?;
                    let db = guard
                        .as_ref()
                        .map_err(|e| ReaderError::new(e.code, "repository unavailable"))?;
                    db.save(&progress)
                })();
                let mut state = lock.lock().unwrap_or_else(|p| p.into_inner());
                if let Err(error) = result {
                    state.error = Some(error.code);
                    if state.pending.is_none() {
                        state.pending = Some(progress);
                    }
                }
                state.writing = None;
                wake.notify_all();
            }
        });
        Self {
            queue,
            thread: Mutex::new(Some(thread)),
        }
    }
    pub fn queue(&self, progress: Progress) -> Result<()> {
        let (lock, wake) = &*self.queue;
        let mut state = lock.lock().map_err(db_error)?;
        if state.stop {
            return Err(db_error("writer stopped"));
        }
        if state
            .pending
            .as_ref()
            .is_some_and(|p| p.book_id != progress.book_id)
            || state
                .writing
                .as_ref()
                .is_some_and(|id| id != &progress.book_id)
        {
            return Err(ReaderError::new(
                ErrorCode::Busy,
                "flush before changing book",
            ));
        }
        state.pending = Some(progress);
        wake.notify_all();
        if let Some(code) = state.error {
            return Err(ReaderError::new(code, "progress write failed"));
        }
        Ok(())
    }
    pub fn flush(&self) -> Result<()> {
        let (lock, wake) = &*self.queue;
        let mut state = lock.lock().map_err(db_error)?;
        state.error = None;
        wake.notify_all();
        while state.writing.is_some()
            || (state.pending.is_some() && state.error.is_none() && !state.stop)
        {
            state = wake.wait(state).map_err(db_error)?;
        }
        if let Some(code) = state.error {
            return Err(ReaderError::new(code, "progress flush failed"));
        }
        Ok(())
    }
    pub fn shutdown(&self) -> Result<()> {
        let result = self.flush();
        let (lock, wake) = &*self.queue;
        if let Ok(mut state) = lock.lock() {
            state.stop = true;
            wake.notify_all();
        }
        if let Ok(mut thread) = self.thread.lock() {
            if let Some(thread) = thread.take() {
                let _ = thread.join();
            }
        }
        result
    }
}
impl Drop for ProgressWriter {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}
