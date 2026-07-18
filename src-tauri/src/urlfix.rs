/// Defensive URL fixing for media/avatar paths returned by the API.
///
/// The server stores avatars as basename (`avatars/<hex>.jpg`) and the serializer
/// prepends `/uploads/` — producing correct paths. Media paths are stored as
/// `/api-uploads/<hex>.<ext>`. All paths are relative and must be absolutized
/// against the issuer for the webview's `<img src>` to work.

pub fn absolutize(path: &str, issuer: &str) -> Option<String> {
    if path.is_empty() { return None; }
    if path.starts_with("http://") || path.starts_with("https://") {
        return Some(path.to_string());
    }
    let cleaned = if path.starts_with("/uploads//uploads/") {
        format!("/uploads/{}", &path["/uploads//uploads/".len()..])
    } else {
        path.to_string()
    };
    if cleaned.starts_with('/') {
        Some(format!("{}{}", issuer, cleaned))
    } else {
        Some(format!("{}/{}", issuer, cleaned))
    }
}
