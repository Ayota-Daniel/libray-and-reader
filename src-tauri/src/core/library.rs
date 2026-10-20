// Domain code has no Tauri or serialization dependency.
pub struct Book {
    pub id: String,
    pub title: String,
}

pub fn list_books() -> Vec<Book> {
    // No catalog or import exists in V0.1. Do not manufacture sample books.
    Vec::new()
}
