use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("not authenticated")]
    NotAuthenticated,
    #[error("oauth error: {0}")]
    Oauth(String),
    #[error("jwt verification failed: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),
    #[error("e2ee error: {0}")]
    E2ee(String),
    #[error("api error {status}: {detail}")]
    Api { status: u16, detail: String },
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Other(String),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
