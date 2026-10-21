fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "list_books",
            "add_books",
            "remove_book",
            "open_library_book",
            "record_progress",
            "flush_progress",
            "begin_open",
            "open_selected",
            "cancel_open",
            "close_book",
            "request_page",
            "release_page",
        ]),
    ))
    .expect("failed to build Tauri permissions");
}
