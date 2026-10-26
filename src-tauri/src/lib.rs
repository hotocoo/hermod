//! Hermod desktop app: Tauri bridge over `hermod-core` and `hermod-node`.
//!
//! `api` holds the single command implementation. `desktop` wires it to Tauri (commands,
//! `hermod-blob://`, notifications, dialogs, updater); the devhost binary wires the same `api`
//! to HTTP for end-to-end tests.

pub mod adapter;
pub mod api;
pub mod blob;
pub mod ctx;
mod desktop;
pub mod keychain;
pub mod local_ai;
pub mod messaging_api;
pub mod notify;
pub mod preview;
pub mod scheduler;
pub mod settings;
mod shell;
mod web_assets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    desktop::run();
}
