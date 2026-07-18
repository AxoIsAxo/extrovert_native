use std::path::PathBuf;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init(app_data_dir: PathBuf) {
    let _ = DATA_DIR.set(app_data_dir);
}

fn data_dir() -> &'static PathBuf {
    DATA_DIR.get().expect("auth::store::init not called")
}

#[derive(Serialize, Deserialize)]
struct Tokens {
    access_token: Option<String>,
    refresh_token: Option<String>,
}

fn tokens_path() -> PathBuf {
    data_dir().join("tokens.json")
}

fn read_tokens() -> Tokens {
    let path = tokens_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Tokens { access_token: None, refresh_token: None })
}

fn write_tokens(t: &Tokens) {
    if let Ok(data) = serde_json::to_string(t) {
        let _ = std::fs::write(tokens_path(), data);
    }
}

pub fn store_access_token(token: &str) -> std::result::Result<(), String> {
    let mut t = read_tokens();
    t.access_token = Some(token.to_string());
    write_tokens(&t);
    Ok(())
}

pub fn get_access_token() -> std::result::Result<Option<String>, String> {
    Ok(read_tokens().access_token)
}

pub fn store_refresh_token(token: &str) -> std::result::Result<(), String> {
    let mut t = read_tokens();
    t.refresh_token = Some(token.to_string());
    write_tokens(&t);
    Ok(())
}

pub fn get_refresh_token() -> std::result::Result<Option<String>, String> {
    Ok(read_tokens().refresh_token)
}

pub fn clear_tokens() -> std::result::Result<(), String> {
    write_tokens(&Tokens { access_token: None, refresh_token: None });
    Ok(())
}
