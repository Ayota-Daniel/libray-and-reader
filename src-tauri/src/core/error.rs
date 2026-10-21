use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorCode {
    InvalidArchive,
    EmptyArchive,
    EncryptedArchive,
    UnsupportedCompression,
    UnsafeEntry,
    LimitExceeded,
    CorruptPage,
    ReadFailed,
    SessionExpired,
    InvalidPage,
    Busy,
    Forbidden,
    PersistenceFailed,
    SourceUnavailable,
    BookNotFound,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidArchive => "invalid_archive",
            Self::EmptyArchive => "empty_archive",
            Self::EncryptedArchive => "encrypted_archive",
            Self::UnsupportedCompression => "unsupported_compression",
            Self::UnsafeEntry => "unsafe_entry",
            Self::LimitExceeded => "limit_exceeded",
            Self::CorruptPage => "corrupt_page",
            Self::ReadFailed => "read_failed",
            Self::SessionExpired => "session_expired",
            Self::InvalidPage => "invalid_page",
            Self::Busy => "busy",
            Self::Forbidden => "forbidden",
            Self::PersistenceFailed => "persistence_failed",
            Self::SourceUnavailable => "source_unavailable",
            Self::BookNotFound => "book_not_found",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidArchive => "This file is not a supported, readable CBZ archive.",
            Self::EmptyArchive => "The archive contains no JPEG or PNG pages.",
            Self::EncryptedArchive => "Encrypted archives are not supported.",
            Self::UnsupportedCompression => "This archive requires an unsupported ZIP compression method.",
            Self::UnsafeEntry => "The archive contains an unsafe entry.",
            Self::LimitExceeded => "This archive or page exceeds the reader's safety limits.",
            Self::CorruptPage => "This page is damaged or is not a valid JPEG or PNG. You can continue to another page.",
            Self::ReadFailed => "The selected file could not be read.",
            Self::SessionExpired => "This reading request has expired. Open the book again if needed.",
            Self::InvalidPage => "This page does not belong to the open book.",
            Self::Busy => "The reader is finishing an earlier operation. Please try again shortly.",
            Self::PersistenceFailed => "Library or reading progress could not be saved or loaded. Check available storage and try again.",
            Self::SourceUnavailable => "This book is unavailable. Restore its original file and try again.",
            Self::BookNotFound => "This book is no longer in the library.",
            Self::Forbidden => "This window is not allowed to access the reader.",
        }
    }
}

#[derive(Debug)]
pub struct ReaderError {
    pub code: ErrorCode,
    pub detail: String,
}
impl ReaderError {
    pub fn new(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}
impl fmt::Display for ReaderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.detail)
    }
}
impl std::error::Error for ReaderError {}
pub type Result<T> = std::result::Result<T, ReaderError>;
