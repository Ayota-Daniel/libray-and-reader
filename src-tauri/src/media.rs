use crate::{
    commands::{allowed_origin, ErrorDto},
    core::{
        error::{ErrorCode as Code, ReaderError as Error},
        reader::Reader,
    },
};
use std::sync::Arc;
use tauri::{
    http::{Request, Response},
    UriSchemeResponder,
};

fn response(
    status: u16,
    mime: &str,
    origin: Option<&str>,
    body: Vec<u8>,
    dimensions: Option<(u32, u32)>,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");
    if let Some(origin) = origin {
        builder = builder
            .header("Access-Control-Allow-Origin", origin)
            .header(
                "Access-Control-Expose-Headers",
                "X-Page-Width, X-Page-Height",
            );
    }
    if let Some((width, height)) = dimensions {
        builder = builder
            .header("X-Page-Width", width)
            .header("X-Page-Height", height);
    }
    builder.body(body).expect("fixed valid HTTP headers")
}
fn reject(responder: UriSchemeResponder, error: Error, origin: Option<&str>) {
    let status = match error.code {
        Code::Forbidden => 403,
        Code::SessionExpired | Code::InvalidPage => 404,
        Code::Busy => 409,
        Code::LimitExceeded => 413,
        _ => 422,
    };
    let body = serde_json::to_vec(&ErrorDto::from(error)).expect("serializable error DTO");
    responder.respond(response(status, "application/json", origin, body, None));
}
pub fn serve(
    reader: Arc<Reader>,
    authorized: bool,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let origin = request
        .headers()
        .get("Origin")
        .and_then(|h| h.to_str().ok())
        .map(str::to_owned);
    if !authorized
        || origin.as_deref().is_some_and(|o| !allowed_origin(o))
        || request.method() != "GET"
    {
        reject(
            responder,
            Error::new(Code::Forbidden, "media window/origin/method"),
            None,
        );
        return;
    }
    let Some((session, ticket)) = parse_path(request.uri().path()) else {
        reject(
            responder,
            Error::new(Code::InvalidPage, "media identifier syntax"),
            origin.as_deref(),
        );
        return;
    };
    let work = match reader.prepare_read(session, ticket) {
        Ok(work) => work,
        Err(error) => {
            reject(responder, error, origin.as_deref());
            return;
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        match work.read() {
            Ok(page) if work.is_current() => responder.respond(response(
                200,
                page.mime,
                origin.as_deref(),
                page.bytes,
                Some((page.width, page.height)),
            )),
            Ok(_) => reject(
                responder,
                Error::new(Code::SessionExpired, "superseded response"),
                origin.as_deref(),
            ),
            Err(error) => reject(responder, error, origin.as_deref()),
        }
        // Work's admission guard lives through response delivery, not just decode.
    });
}
fn parse_path(path: &str) -> Option<(&str, &str)> {
    let (session, ticket) = path.strip_prefix('/')?.split_once('_')?;
    let valid = |id: &str| {
        id.len() == 32
            && id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    };
    (valid(session) && valid(ticket)).then_some((session, ticket))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn path_only_accepts_two_opaque_ids() {
        assert!(parse_path(&format!("/{}_{}", "a".repeat(32), "b".repeat(32))).is_some());
        for path in ["/etc/passwd", "/../x", "/a_b", "/%2f", "/a_b_c"] {
            assert!(parse_path(path).is_none());
        }
        assert!(!allowed_origin("https://example.com"));
    }
}
