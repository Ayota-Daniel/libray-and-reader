mod commands;
mod core;
mod media;

use std::sync::Arc;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(core::reader::Reader::default()))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = app
                .path()
                .app_data_dir()
                .map_err(|e| {
                    core::error::ReaderError::new(
                        core::error::ErrorCode::PersistenceFailed,
                        e.to_string(),
                    )
                })
                .and_then(|dir| {
                    std::fs::create_dir_all(&dir).map_err(|e| {
                        core::error::ReaderError::new(
                            core::error::ErrorCode::PersistenceFailed,
                            e.to_string(),
                        )
                    })?;
                    Ok(dir.join("library.sqlite3"))
                });
            let app_data = app.path().app_data_dir().map_err(|e| {
                core::error::ReaderError::new(
                    core::error::ErrorCode::PersistenceFailed,
                    e.to_string(),
                )
            })?;
            app.manage(core::library::Library::open(path, app_data));
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("page", |context, request, responder| {
            let reader = context
                .app_handle()
                .state::<Arc<core::reader::Reader>>()
                .inner()
                .clone();
            let authorized = context
                .app_handle()
                .get_webview_window(context.webview_label())
                .is_some_and(|window| commands::authorize(&window).is_ok());
            media::serve(reader, authorized, request, responder);
        })
        .register_asynchronous_uri_scheme_protocol("cover", |context, request, responder| {
            let library = context
                .app_handle()
                .state::<Arc<core::library::Library>>()
                .inner()
                .clone();
            let authorized = context
                .app_handle()
                .get_webview_window(context.webview_label())
                .is_some_and(|window| commands::authorize(&window).is_ok());
            media::serve_cover(library, authorized, request, responder);
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "main" {
                if let Err(error) = window.state::<Arc<core::library::Library>>().shutdown() {
                    eprintln!("Persistence shutdown: {error}");
                }
                window.state::<Arc<core::reader::Reader>>().shutdown();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_books,
            commands::add_books,
            commands::remove_book,
            commands::open_library_book,
            commands::record_progress,
            commands::flush_progress,
            commands::begin_open,
            commands::open_selected,
            commands::cancel_open,
            commands::close_book,
            commands::request_page,
            commands::release_page
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Manga Reader");
}
