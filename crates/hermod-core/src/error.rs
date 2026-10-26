//! Crate-wide error type.

use std::io;

/// Everything that can go wrong inside hermod-core.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("cbor: {0}")]
    Cbor(String),
    /// Display text is matched by the UI (`LOCKED_ERROR` in src/config/app.ts).
    #[error("identity locked")]
    Locked,
    #[error("decryption failed")]
    Decrypt,
    #[error("bad signature")]
    BadSignature,
    #[error("invalid {what}: {detail}")]
    Invalid { what: &'static str, detail: String },
    #[error("invite expired")]
    InviteExpired,
    #[error("unknown space {0}")]
    UnknownSpace(String),
    #[error("conflicting event for the same author and seq")]
    Equivocation,
    #[error("not found: {0}")]
    NotFound(String),
    #[error("database is damaged: {0}")]
    Corrupt(String),
    #[error("rate limit exceeded for author {0}")]
    RateLimited(String),
    #[error("not allowed: {0}")]
    Forbidden(String),
}

impl Error {
    pub(crate) fn invalid(what: &'static str, detail: impl Into<String>) -> Self {
        Error::Invalid {
            what,
            detail: detail.into(),
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
