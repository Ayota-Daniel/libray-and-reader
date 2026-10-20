// Explicit budgets, also used by the synthetic boundary tests.
#[derive(Clone, Copy)]
pub struct Limits {
    pub archive_bytes: u64,
    pub entries: usize,
    pub metadata_bytes: u64,
    pub page_bytes: usize,
    pub pixels: u64,
    pub dimension: u32,
    pub decode_bytes: u64,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            archive_bytes: 1024 * 1024 * 1024,
            entries: 10_000,
            metadata_bytes: 8 * 1024 * 1024,
            page_bytes: 24 * 1024 * 1024,
            pixels: 12_000_000,
            dimension: 16_384,
            decode_bytes: 96 * 1024 * 1024,
        }
    }
}
