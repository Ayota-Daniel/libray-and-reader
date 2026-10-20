mod commands;
mod core;
mod media;

use std::sync::Arc;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(core::reader::Reader::default()))
        .plugin(tauri_plugin_dialog::init())
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
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "main" {
                window.state::<Arc<core::reader::Reader>>().shutdown();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_books,
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
