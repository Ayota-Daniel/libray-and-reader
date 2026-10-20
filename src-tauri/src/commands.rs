use crate::core::library;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDto {
    id: String,
    title: String,
}

#[tauri::command]
pub fn list_books() -> Vec<BookDto> {
    library::list_books()
        .into_iter()
        .map(|book| BookDto {
            id: book.id,
            title: book.title,
        })
        .collect()
}
