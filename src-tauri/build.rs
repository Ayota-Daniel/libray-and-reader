fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "list_books",
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
