mod commands;
mod core;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::list_books])
        .run(tauri::generate_context!())
        .expect("failed to run Manga Reader");
}
