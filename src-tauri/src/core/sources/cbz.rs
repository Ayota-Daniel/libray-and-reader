use super::{PageData, PageSource};
use crate::core::{
    error::{ErrorCode as Code, ReaderError as Error, Result},
    limits::Limits,
};
use image::{ImageDecoder, ImageFormat, ImageReader};
use rawzip::{CompressionMethod, FileReader, ZipArchive, ZipArchiveEntryWayfinder};
use std::{
    cmp::Ordering,
    fs::File,
    io::{Cursor, Read, Seek, SeekFrom},
    path::Path,
};

pub struct CbzSource {
    archive: ZipArchive<FileReader>,
    entries: Vec<(ZipArchiveEntryWayfinder, CompressionMethod)>,
    limits: Limits,
}

fn invalid(detail: impl Into<String>) -> Error {
    Error::new(Code::InvalidArchive, detail)
}
fn io_error(e: std::io::Error) -> Error {
    Error::new(Code::ReadFailed, e.to_string())
}
fn limit(detail: &str) -> Error {
    Error::new(Code::LimitExceeded, detail)
}
fn check_current(current: &dyn Fn() -> bool) -> Result<()> {
    if current() {
        Ok(())
    } else {
        Err(Error::new(Code::SessionExpired, "operation cancelled"))
    }
}
fn u16_at(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}
fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .expect("fixed header slice"),
    )
}

// Bound metadata BEFORE ZipArchive allocates its central-directory structures.
// ZIP64, split archives, SFX and trailing bytes are deliberately outside V0.2.
fn preflight(
    file: &mut File,
    limits: Limits,
    current: &dyn Fn() -> bool,
) -> Result<(usize, u64, u64)> {
    let len = file.metadata().map_err(io_error)?.len();
    if len > limits.archive_bytes {
        return Err(limit("archive bytes"));
    }
    if len < 22 {
        return Err(invalid("missing ZIP footer"));
    }
    let tail_len = len.min(65_557) as usize;
    file.seek(SeekFrom::End(-(tail_len as i64)))
        .map_err(io_error)?;
    let mut tail = vec![0; tail_len];
    file.read_exact(&mut tail).map_err(io_error)?;
    let footer = (0..=tail_len - 22)
        .rev()
        .find(|&i| {
            tail[i..i + 4] == *b"PK\x05\x06" && i + 22 + u16_at(&tail, i + 20) as usize == tail_len
        })
        .ok_or_else(|| invalid("invalid ZIP footer"))?;
    let header = &tail[footer..];
    let count = u16_at(header, 10) as usize;
    let size = u32_at(header, 12) as u64;
    let start = u32_at(header, 16) as u64;
    if u16_at(header, 4) != 0 || u16_at(header, 6) != 0 || u16_at(header, 8) as usize != count {
        return Err(invalid("split ZIP archives are unsupported"));
    }
    if count == u16::MAX as usize || size == u32::MAX as u64 || start == u32::MAX as u64 {
        return Err(invalid("ZIP64 is unsupported"));
    }
    if count > limits.entries || size + u16_at(header, 20) as u64 > limits.metadata_bytes {
        return Err(limit("central-directory metadata or entry count"));
    }
    let footer_offset = len - tail_len as u64 + footer as u64;
    if start.checked_add(size) != Some(footer_offset) {
        return Err(invalid("central-directory extent"));
    }
    file.seek(SeekFrom::Start(start)).map_err(io_error)?;
    let mut consumed = 0u64;
    for _ in 0..count {
        check_current(current)?;
        if consumed + 46 > size {
            return Err(invalid("truncated central directory"));
        }
        let mut entry = [0; 46];
        file.read_exact(&mut entry).map_err(io_error)?;
        if &entry[..4] != b"PK\x01\x02" {
            return Err(invalid("central-directory signature"));
        }
        let flags = u16_at(&entry, 8);
        if flags & (1 | 64) != 0 {
            return Err(Error::new(Code::EncryptedArchive, "encrypted ZIP entry"));
        }
        if u32_at(&entry, 20) == u32::MAX
            || u32_at(&entry, 24) == u32::MAX
            || u32_at(&entry, 42) == u32::MAX
            || u16_at(&entry, 34) != 0
        {
            return Err(invalid("ZIP64 or split entry"));
        }
        let extra =
            u16_at(&entry, 28) as u64 + u16_at(&entry, 30) as u64 + u16_at(&entry, 32) as u64;
        consumed += 46 + extra;
        if consumed > size {
            return Err(invalid("entry exceeds central directory"));
        }
        file.seek(SeekFrom::Current(extra as i64))
            .map_err(io_error)?;
    }
    if consumed != size {
        return Err(invalid("central-directory count mismatch"));
    }
    file.seek(SeekFrom::Start(0)).map_err(io_error)?;
    Ok((count, start, size + u16_at(header, 20) as u64))
}

pub(crate) fn safe_name(name: &str) -> bool {
    // Treat both separator conventions on every host. Reject drive prefixes,
    // alternate streams, UNC/device paths, control chars and ambiguous components.
    !name.is_empty()
        && !name.starts_with(['/', '\\'])
        && !name.contains([':', '\0'])
        && !name.chars().any(char::is_control)
        && !name
            .replace('\\', "/")
            .trim_end_matches('/')
            .split('/')
            .any(|part| {
                part.is_empty()
                    || part == "."
                    || part == ".."
                    || part.ends_with([' ', '.'])
                    || reserved_windows_name(part)
            })
}
fn reserved_windows_name(part: &str) -> bool {
    let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || (stem.len() == 4
        && (stem.starts_with("COM") || stem.starts_with("LPT"))
        && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

fn parasite(name: &str) -> bool {
    name.split('/')
        .any(|part| part == "__MACOSX" || part == ".DS_Store" || part.starts_with("._"))
}

// ASCII digit runs compare by magnitude without parsing/overflow. ASCII case folds;
// equal magnitude uses shorter spelling first. Other Unicode compares by UTF-8.
// Full normalized relative paths participate, then raw spelling, then ZIP index.
pub(crate) fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let (mut ae, mut be) = (i, j);
            while ae < a.len() && a[ae].is_ascii_digit() {
                ae += 1;
            }
            while be < b.len() && b[be].is_ascii_digit() {
                be += 1;
            }
            let (mut az, mut bz) = (i, j);
            while az < ae && a[az] == b'0' {
                az += 1;
            }
            while bz < be && b[bz] == b'0' {
                bz += 1;
            }
            let cmp = (ae - az)
                .cmp(&(be - bz))
                .then_with(|| a[az..ae].cmp(&b[bz..be]))
                .then_with(|| (ae - i).cmp(&(be - j)));
            if cmp != Ordering::Equal {
                return cmp;
            }
            i = ae;
            j = be;
        } else {
            let cmp = a[i].to_ascii_lowercase().cmp(&b[j].to_ascii_lowercase());
            if cmp != Ordering::Equal {
                return cmp;
            }
            i += 1;
            j += 1;
        }
    }
    (a.len() - i).cmp(&(b.len() - j))
}

impl CbzSource {
    pub fn open(path: &Path, limits: Limits, current: &dyn Fn() -> bool) -> Result<Self> {
        if !path
            .extension()
            .is_some_and(|s| s.eq_ignore_ascii_case("cbz"))
        {
            return Err(invalid("expected .cbz extension"));
        }
        if !std::fs::metadata(path).map_err(io_error)?.is_file() {
            return Err(invalid("not a regular file"));
        }
        let mut file = File::open(path).map_err(io_error)?;
        if !file.metadata().map_err(io_error)?.is_file() {
            return Err(invalid("not a regular file"));
        }
        let (expected_count, directory_start, mut metadata_bytes) =
            preflight(&mut file, limits, current)?;
        let mut buffer = vec![0; rawzip::RECOMMENDED_BUFFER_SIZE];
        let archive =
            ZipArchive::from_file(file, &mut buffer).map_err(|e| invalid(e.to_string()))?;
        let mut entries = archive.entries(&mut buffer);
        let mut local_buffer = vec![0; 131_070];
        let mut pages = Vec::new();
        let mut ranges = Vec::new();
        let mut count = 0;
        while let Some(entry) = entries.next_entry().map_err(|e| invalid(e.to_string()))? {
            check_current(current)?;
            count += 1;
            if count > expected_count {
                return Err(invalid("entry count mismatch"));
            }
            let name = std::str::from_utf8(entry.file_path().as_bytes())
                .map_err(|_| invalid("entry name must be UTF-8 or ASCII"))?;
            if !safe_name(name) || entry.mode().is_symlink() {
                return Err(Error::new(
                    Code::UnsafeEntry,
                    format!("unsafe entry index {}", count - 1),
                ));
            }
            let normalized = name.replace('\\', "/");
            let local = archive
                .get_entry(entry.wayfinder())
                .map_err(|e| invalid(e.to_string()))?;
            let header = local
                .local_header(&mut local_buffer)
                .map_err(|e| invalid(e.to_string()))?;
            if header.flags().bits() & (1 | 64) != 0 || entry.flags().is_encrypted() {
                return Err(Error::new(Code::EncryptedArchive, "encrypted entry"));
            }
            if header.file_path().as_bytes() != entry.file_path().as_bytes()
                || header.compression_method() != entry.compression_method()
            {
                return Err(invalid("local/central header mismatch"));
            }
            let (start, end) = local.compressed_data_range();
            let header_start = entry.local_header_offset();
            if start < header_start || end > directory_start {
                return Err(invalid("entry extent outside data area"));
            }
            metadata_bytes += start - header_start;
            if metadata_bytes > limits.metadata_bytes {
                return Err(limit("central and local metadata bytes"));
            }
            ranges.push((header_start, end));
            if entry.is_dir() || parasite(&normalized) {
                continue;
            }
            let extension = normalized
                .rsplit('.')
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();
            if !matches!(extension.as_str(), "png" | "jpg" | "jpeg") {
                continue;
            }
            if !matches!(
                entry.compression_method(),
                CompressionMethod::STORE | CompressionMethod::DEFLATE
            ) {
                return Err(Error::new(
                    Code::UnsupportedCompression,
                    format!("entry index {}", count - 1),
                ));
            }
            if entry.uncompressed_size_hint() > limits.page_bytes as u64
                || entry.compressed_size_hint() > limits.page_bytes as u64
            {
                return Err(limit("declared page bytes"));
            }
            pages.push((
                normalized,
                count - 1,
                entry.wayfinder(),
                entry.compression_method(),
            ));
        }
        if count != expected_count {
            return Err(invalid("entry count mismatch"));
        }
        ranges.sort_unstable();
        if ranges.first().is_some_and(|range| range.0 != 0) {
            return Err(invalid("self-extracting ZIP prelude is unsupported"));
        }
        if ranges.windows(2).any(|pair| pair[0].1 > pair[1].0) {
            return Err(invalid("overlapping entry data"));
        }
        if pages.is_empty() {
            return Err(Error::new(Code::EmptyArchive, "no supported entries"));
        }
        pages.sort_by(|a, b| {
            natural_cmp(&a.0, &b.0)
                .then_with(|| a.0.cmp(&b.0))
                .then_with(|| a.1.cmp(&b.1))
        });
        Ok(Self {
            archive,
            entries: pages
                .into_iter()
                .map(|(_, _, entry, method)| (entry, method))
                .collect(),
            limits,
        })
    }
}

pub(crate) fn read_bounded(
    reader: &mut impl Read,
    max: usize,
    current: &dyn Fn() -> bool,
) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut chunk = [0; 16 * 1024];
    loop {
        check_current(current)?;
        let count = reader
            .read(&mut chunk)
            .map_err(|e| Error::new(Code::CorruptPage, e.to_string()))?;
        if count == 0 {
            break;
        }
        if bytes.len() + count > max {
            return Err(limit("actual decompressed page bytes"));
        }
        // Avoid Vec's geometric capacity growing beyond the byte budget.
        bytes.reserve_exact(count);
        bytes.extend_from_slice(&chunk[..count]);
    }
    Ok(bytes)
}
impl PageSource for CbzSource {
    fn page_count(&self) -> usize {
        self.entries.len()
    }
    fn read_page(&mut self, index: usize, current: &dyn Fn() -> bool) -> Result<PageData> {
        check_current(current)?;
        let (wayfinder, method) = *self
            .entries
            .get(index)
            .ok_or_else(|| Error::new(Code::InvalidPage, "page index"))?;
        let entry = self
            .archive
            .get_entry(wayfinder)
            .map_err(|e| Error::new(Code::CorruptPage, e.to_string()))?;
        let bytes = if method == CompressionMethod::STORE {
            read_bounded(&mut entry.reader(), self.limits.page_bytes, current)?
        } else {
            let decoder = flate2::read::DeflateDecoder::new(entry.reader());
            read_bounded(&mut { decoder }, self.limits.page_bytes, current)?
        };
        check_current(current)?;
        entry
            .reader()
            .claim_verifier()
            .valid(rawzip::ZipVerification {
                crc: rawzip::crc32(&bytes),
                uncompressed_size: bytes.len() as u64,
            })
            .map_err(|e| Error::new(Code::CorruptPage, e.to_string()))?;
        validate_image(bytes, self.limits, current)
    }
}

pub(crate) fn validate_image(
    bytes: Vec<u8>,
    limits: Limits,
    current: &dyn Fn() -> bool,
) -> Result<PageData> {
    let format =
        image::guess_format(&bytes).map_err(|e| Error::new(Code::CorruptPage, e.to_string()))?;
    if format == ImageFormat::Png {
        // APNG could make the WebView decode an unbounded number of animation
        // frames although our validator only decodes the first static image.
        let mut offset = 8usize;
        while offset.checked_add(12).is_some_and(|end| end <= bytes.len()) {
            let length = u32::from_be_bytes(
                bytes[offset..offset + 4]
                    .try_into()
                    .expect("PNG chunk length"),
            ) as usize;
            if &bytes[offset + 4..offset + 8] == b"acTL" {
                return Err(Error::new(Code::CorruptPage, "animated PNG is unsupported"));
            }
            let Some(end) = offset.checked_add(12).and_then(|n| n.checked_add(length)) else {
                break;
            };
            if end > bytes.len() {
                break;
            }
            offset = end;
        }
    }
    let mime = match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        _ => return Err(Error::new(Code::CorruptPage, "unsupported signature")),
    };
    let mut reader = ImageReader::with_format(Cursor::new(&bytes), format);
    let mut decode_limits = image::Limits::default();
    decode_limits.max_image_width = Some(limits.dimension);
    decode_limits.max_image_height = Some(limits.dimension);
    decode_limits.max_alloc = Some(limits.decode_bytes);
    reader.limits(decode_limits);
    let decoder = reader.into_decoder().map_err(image_error)?;
    let (width, height) = decoder.dimensions();
    if width == 0
        || height == 0
        || u64::from(width) * u64::from(height) > limits.pixels
        || decoder.total_bytes() > limits.decode_bytes
    {
        return Err(limit("image dimensions or decode budget"));
    }
    check_current(current)?;
    // Validate the entire current image, not every image at open. This temporary
    // decoded allocation is bounded above and dropped before the encoded response.
    let decoded = image::DynamicImage::from_decoder(decoder).map_err(image_error)?;
    drop(decoded);
    check_current(current)?;
    Ok(PageData {
        bytes,
        mime,
        width,
        height,
    })
}
fn image_error(error: image::ImageError) -> Error {
    let code = if matches!(error, image::ImageError::Limits(_)) {
        Code::LimitExceeded
    } else {
        Code::CorruptPage
    };
    Error::new(code, error.to_string())
}

#[cfg(test)]
mod tests;
