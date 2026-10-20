pub mod cbz;

use super::error::Result;

pub struct PageData {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    pub width: u32,
    pub height: u32,
}

// The concrete local source is sufficient for V0.2; no provider registry or ABI.
// Session ownership and cancellation live above it. Page indices never cross IPC.
pub trait PageSource: Send {
    fn page_count(&self) -> usize;
    fn read_page(&mut self, index: usize, current: &dyn Fn() -> bool) -> Result<PageData>;
}
