use super::reader::opaque_id;
use image::{DynamicImage, ImageFormat};
use std::{
    io::{Cursor, Write},
    path::PathBuf,
};

pub fn image_bytes(format: ImageFormat, width: u32, height: u32) -> Vec<u8> {
    let mut cursor = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(width, height)
        .write_to(&mut cursor, format)
        .unwrap();
    cursor.into_inner()
}
#[derive(Clone)]
pub struct Entry {
    pub name: String,
    pub data: Vec<u8>,
    pub method: u16,
    pub flags: u16,
    pub mode: u32,
    pub size_override: Option<u32>,
    pub bad_crc: bool,
}
impl Entry {
    pub fn new(name: &str, data: Vec<u8>, method: u16) -> Self {
        Self {
            name: name.into(),
            data,
            method,
            flags: 0x800,
            mode: 0o100644,
            size_override: None,
            bad_crc: false,
        }
    }
}
fn short(out: &mut Vec<u8>, n: u16) {
    out.extend(n.to_le_bytes());
}
fn long(out: &mut Vec<u8>, n: u32) {
    out.extend(n.to_le_bytes());
}
// Minimal independent ZIP writer allows duplicate names, corrupt metadata and
// unsupported methods without depending on a reader's own writer behavior.
pub fn zip(entries: &[Entry]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut directory = Vec::new();
    for entry in entries {
        let offset = out.len() as u32;
        let compressed = if entry.method == 8 {
            let mut writer =
                flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
            writer.write_all(&entry.data).unwrap();
            writer.finish().unwrap()
        } else {
            entry.data.clone()
        };
        let mut crc = rawzip::Crc32::new();
        crc.update(&entry.data);
        let checksum = if entry.bad_crc {
            0x12345678
        } else {
            crc.checksum()
        };
        let size = entry.size_override.unwrap_or(entry.data.len() as u32);
        long(&mut out, 0x04034b50);
        short(&mut out, 20);
        short(&mut out, entry.flags);
        short(&mut out, entry.method);
        short(&mut out, 0);
        short(&mut out, 0);
        long(&mut out, checksum);
        long(&mut out, compressed.len() as u32);
        long(&mut out, size);
        short(&mut out, entry.name.len() as u16);
        short(&mut out, 0);
        out.extend(entry.name.as_bytes());
        out.extend(compressed.iter());
        long(&mut directory, 0x02014b50);
        short(&mut directory, 0x0314);
        short(&mut directory, 20);
        short(&mut directory, entry.flags);
        short(&mut directory, entry.method);
        short(&mut directory, 0);
        short(&mut directory, 0);
        long(&mut directory, checksum);
        long(&mut directory, compressed.len() as u32);
        long(&mut directory, size);
        short(&mut directory, entry.name.len() as u16);
        short(&mut directory, 0);
        short(&mut directory, 0);
        short(&mut directory, 0);
        short(&mut directory, 0);
        long(&mut directory, entry.mode << 16);
        long(&mut directory, offset);
        directory.extend(entry.name.as_bytes());
    }
    let start = out.len() as u32;
    out.extend(&directory);
    long(&mut out, 0x06054b50);
    short(&mut out, 0);
    short(&mut out, 0);
    short(&mut out, entries.len() as u16);
    short(&mut out, entries.len() as u16);
    long(&mut out, directory.len() as u32);
    long(&mut out, start);
    short(&mut out, 0);
    out
}
pub struct Fixture {
    pub path: PathBuf,
}
impl Fixture {
    pub fn new(data: &[u8]) -> Self {
        let path = std::env::temp_dir().join(format!("manga-reader-test-{}.cbz", opaque_id()));
        std::fs::write(&path, data).unwrap();
        Self { path }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}
