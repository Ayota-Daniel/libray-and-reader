use super::*;
use crate::core::test_support::{image_bytes, zip, Entry, Fixture};
fn png(w: u32) -> Vec<u8> {
    image_bytes(ImageFormat::Png, w, 2)
}
fn open_error(entries: &[Entry], code: Code) {
    let f = Fixture::new(&zip(entries));
    let err = match CbzSource::open(&f.path, Limits::default(), &|| true) {
        Ok(_) => panic!("expected error"),
        Err(e) => e,
    };
    assert_eq!(err.code, code, "{err}");
}
#[test]
fn stored_deflate_subfolders_duplicate_names_and_natural_order() {
    let entries = [
        Entry::new("folder/page10.png", png(10), 8),
        Entry::new("folder/page2.png", png(2), 0),
        Entry::new("folder/page1.png", png(1), 8),
        Entry::new("folder/page2.png", png(3), 8),
    ];
    let f = Fixture::new(&zip(&entries));
    let mut book = CbzSource::open(&f.path, Limits::default(), &|| true).unwrap();
    assert_eq!(book.page_count(), 4);
    let widths: Vec<_> = (0..4)
        .map(|i| book.read_page(i, &|| true).unwrap().width)
        .collect();
    assert_eq!(widths, [1, 2, 3, 10]);
    assert_eq!(
        book.read_page(4, &|| true).err().unwrap().code,
        Code::InvalidPage
    );
}
#[test]
fn one_jpeg_and_signature_not_extension_controls_mime() {
    let f = Fixture::new(&zip(&[Entry::new(
        "page.png",
        image_bytes(ImageFormat::Jpeg, 3, 4),
        0,
    )]));
    let mut book = CbzSource::open(&f.path, Limits::default(), &|| true).unwrap();
    let page = book.read_page(0, &|| true).unwrap();
    assert_eq!((page.mime, page.width, page.height), ("image/jpeg", 3, 4));
}
#[test]
fn sorting_is_locale_free_with_case_zeroes_unicode_and_ties() {
    let mut names = [
        "page10",
        "page02",
        "page2",
        "page1",
        "Page1",
        "章2/page1",
        "章10/page1",
        "page0002",
    ];
    names.sort_by(|a, b| natural_cmp(a, b).then_with(|| a.cmp(b)));
    assert_eq!(
        names,
        [
            "Page1",
            "page1",
            "page2",
            "page02",
            "page0002",
            "page10",
            "章2/page1",
            "章10/page1"
        ]
    );
    assert_eq!(
        natural_cmp("page99999999999999999999", "page100000000000000000000"),
        Ordering::Less
    );
}
#[test]
fn rejects_cross_platform_unsafe_names_even_in_ignored_entries() {
    for name in [
        "/abs.png",
        "../p.png",
        "a/../../p.png",
        "C:\\p.png",
        "C:p.png",
        "\\\\host\\p.png",
        "a\\..\\p.png",
        "a/./p.png",
        "a//p.png",
        "a./p.png",
        "x\0.png",
    ] {
        assert!(!safe_name(name), "{name}");
        open_error(&[Entry::new(name, png(1), 0)], Code::UnsafeEntry);
    }
    let mut link = Entry::new("link.png", png(1), 0);
    link.mode = 0o120777;
    open_error(&[link], Code::UnsafeEntry);
}
#[test]
fn empty_parasites_and_unsupported_files() {
    open_error(&[], Code::EmptyArchive);
    open_error(
        &[Entry::new("README.txt", b"hi".to_vec(), 0)],
        Code::EmptyArchive,
    );
    let f = Fixture::new(&zip(&[
        Entry::new("__MACOSX/p.png", png(8), 0),
        Entry::new("._page.png", png(9), 0),
        Entry::new(".DS_Store", vec![], 0),
        Entry::new("folder/", vec![], 0),
        Entry::new("page.png", png(1), 0),
    ]));
    assert_eq!(
        CbzSource::open(&f.path, Limits::default(), &|| true)
            .unwrap()
            .page_count(),
        1
    );
}
#[test]
fn invalid_truncated_encrypted_and_unsupported_compression() {
    for bytes in [
        b"not zip".to_vec(),
        zip(&[Entry::new("p.png", png(1), 0)])[..30].to_vec(),
    ] {
        let f = Fixture::new(&bytes);
        assert!(CbzSource::open(&f.path, Limits::default(), &|| true).is_err());
    }
    let mut entry = Entry::new("p.png", png(1), 0);
    entry.flags |= 1;
    open_error(&[entry], Code::EncryptedArchive);
    open_error(
        &[Entry::new("p.png", png(1), 12)],
        Code::UnsupportedCompression,
    );
}
#[test]
fn explicit_open_limits_before_image_decompression() {
    let f = Fixture::new(&zip(&[Entry::new("p.png", png(1), 0)]));
    for limits in [
        Limits {
            archive_bytes: 10,
            ..Limits::default()
        },
        Limits {
            entries: 0,
            ..Limits::default()
        },
        Limits {
            metadata_bytes: 10,
            ..Limits::default()
        },
        Limits {
            page_bytes: 1,
            ..Limits::default()
        },
    ] {
        assert_eq!(
            CbzSource::open(&f.path, limits, &|| true)
                .err()
                .unwrap()
                .code,
            Code::LimitExceeded
        );
    }
}
#[test]
fn actual_inflation_is_bounded_independently_of_declared_size() {
    let mut entry = Entry::new("bomb.png", vec![0; 128 * 1024], 8);
    entry.size_override = Some(1);
    let f = Fixture::new(&zip(&[entry]));
    let mut book = CbzSource::open(
        &f.path,
        Limits {
            page_bytes: 1024,
            ..Limits::default()
        },
        &|| true,
    )
    .unwrap();
    assert_eq!(
        book.read_page(0, &|| true).err().unwrap().code,
        Code::LimitExceeded
    );
}
#[test]
fn dimensions_and_decoder_budget_are_enforced() {
    for limits in [
        Limits {
            pixels: 1,
            ..Limits::default()
        },
        Limits {
            dimension: 1,
            ..Limits::default()
        },
        Limits {
            decode_bytes: 1,
            ..Limits::default()
        },
    ] {
        assert_eq!(
            validate_image(png(3), limits, &|| true).err().unwrap().code,
            Code::LimitExceeded
        );
    }
}
#[test]
fn opens_without_decoding_corruption_is_local_and_crc_checked() {
    let mut crc = Entry::new("p2.png", png(2), 8);
    crc.bad_crc = true;
    let f = Fixture::new(&zip(&[
        Entry::new("p1.png", b"broken".to_vec(), 0),
        crc,
        Entry::new("p3.png", png(3), 0),
    ]));
    let mut book = CbzSource::open(&f.path, Limits::default(), &|| true).unwrap();
    assert_eq!(book.page_count(), 3);
    for i in 0..2 {
        assert_eq!(
            book.read_page(i, &|| true).err().unwrap().code,
            Code::CorruptPage
        );
    }
    assert_eq!(book.read_page(2, &|| true).unwrap().width, 3);
    assert_eq!(book.page_count(), 3);
}
#[test]
fn cancelled_reads_and_open_exit_early() {
    let f = Fixture::new(&zip(&[Entry::new("p.png", png(1), 0)]));
    assert_eq!(
        CbzSource::open(&f.path, Limits::default(), &|| false)
            .err()
            .unwrap()
            .code,
        Code::SessionExpired
    );
    let mut book = CbzSource::open(&f.path, Limits::default(), &|| true).unwrap();
    assert_eq!(
        book.read_page(0, &|| false).err().unwrap().code,
        Code::SessionExpired
    );
}
#[test]
fn rejects_truncated_png_and_huge_headers_before_decode() {
    let mut huge = png(1);
    huge[16..20].copy_from_slice(&100_000u32.to_be_bytes());
    let crc = rawzip::crc32(&huge[12..29]);
    huge[29..33].copy_from_slice(&crc.to_be_bytes());
    assert_eq!(
        validate_image(huge, Limits::default(), &|| true)
            .err()
            .unwrap()
            .code,
        Code::LimitExceeded
    );
    let truncated = png(1)[..40].to_vec();
    assert_eq!(
        validate_image(truncated, Limits::default(), &|| true)
            .err()
            .unwrap()
            .code,
        Code::CorruptPage
    );
    let mut animated = png(1);
    let mut chunk = 8u32.to_be_bytes().to_vec();
    chunk.extend(b"acTL");
    chunk.extend([0; 8]);
    let crc = rawzip::crc32(&chunk[4..]);
    chunk.extend(crc.to_be_bytes());
    animated.splice(33..33, chunk);
    assert_eq!(
        validate_image(animated, Limits::default(), &|| true)
            .err()
            .unwrap()
            .code,
        Code::CorruptPage
    );
}
#[test]
fn rejects_local_header_disagreement_and_windows_device_names() {
    for name in ["CON.png", "a/COM1.jpg", "NUL", "LPT9.png"] {
        open_error(&[Entry::new(name, png(1), 0)], Code::UnsafeEntry);
    }
    let mut bytes = zip(&[Entry::new("page.png", png(1), 0)]);
    bytes[30] = b'x'; // Local name disagrees with central name.
    let fixture = Fixture::new(&bytes);
    assert_eq!(
        CbzSource::open(&fixture.path, Limits::default(), &|| true)
            .err()
            .unwrap()
            .code,
        Code::InvalidArchive
    );
}
