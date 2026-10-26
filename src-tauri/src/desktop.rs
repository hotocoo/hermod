//! Tauri wiring: command routing, `hermod-blob://`, OS integration (`Shell`), lifecycle.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{Value, json};
use tauri::http::{Request, Response};
use tauri::ipc::{InvokeBody, InvokeError};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent, Wry};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

use crate::ctx::{BoxFut, Ctx, Options, Shell};
use crate::{api, blob, shell};

const LOG_FILE: &str = "hermod";
const LOG_MAX_BYTES: u128 = 5_000_000;
const LOG_KEEP: usize = 5;

struct TauriShell(AppHandle);

fn extensions(accept: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for a in accept {
        match a.as_str() {
            "image/*" => {
                out.extend(["png", "jpg", "jpeg", "gif", "webp", "avif"].map(String::from))
            }
            "video/*" => out.extend(["mp4", "webm", "mov", "m4v"].map(String::from)),
            "audio/*" => out.extend(["mp3", "wav", "ogg", "flac", "m4a"].map(String::from)),
            x if x.starts_with('.') => out.push(x.trim_start_matches('.').to_string()),
            _ => {}
        }
    }
    out
}

impl Shell for TauriShell {
    fn notify(&self, title: &str, body: &str) {
        if let Err(e) = self
            .0
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
        {
            tracing::warn!("notification failed: {e}");
        }
    }

    fn badge(&self, count: u32) {
        if let Some(w) = self.0.get_webview_window("main") {
            // Unsupported on Windows; the tray tooltip below covers every platform.
            let _ = w.set_badge_count((count > 0).then_some(count.into()));
        }
        if let Some(t) = self.0.tray_by_id(shell::TRAY_ID) {
            let _ = t.set_tooltip(Some(shell::tray_tooltip(count)));
        }
    }

    fn pick_files(
        &self,
        multiple: bool,
        accept: &[String],
    ) -> Result<Option<Vec<PathBuf>>, String> {
        let exts = extensions(accept);
        let mut b = self.0.dialog().file();
        if !exts.is_empty() {
            let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
            b = b.add_filter("Files", &refs);
        }
        let picked = if multiple {
            b.blocking_pick_files()
        } else {
            b.blocking_pick_file().map(|f| vec![f])
        };
        picked
            .map(|v| {
                v.into_iter()
                    .map(|f| f.into_path().map_err(|e| e.to_string()))
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()
    }

    fn save_dialog(&self, suggested: &str) -> Result<Option<PathBuf>, String> {
        self.0
            .dialog()
            .file()
            .set_file_name(suggested)
            .blocking_save_file()
            .map(|f| f.into_path().map_err(|e| e.to_string()))
            .transpose()
    }

    fn update_check(&self) -> BoxFut<Result<Value, String>> {
        let app = self.0.clone();
        Box::pin(async move {
            let current = app.package_info().version.to_string();
            let updater = app.updater().map_err(|e| e.to_string())?;
            match updater.check().await {
                Ok(Some(u)) => Ok(
                    json!({ "available": true, "version": u.version, "notes": u.body, "current": current }),
                ),
                Ok(None) => Ok(json!({ "available": false, "current": current })),
                Err(e) => Err(format!("could not check for updates: {e}")),
            }
        })
    }

    fn update_install(&self) -> BoxFut<Result<(), String>> {
        let app = self.0.clone();
        Box::pin(async move {
            let updater = app.updater().map_err(|e| e.to_string())?;
            let Some(update) = updater
                .check()
                .await
                .map_err(|e| format!("could not check for updates: {e}"))?
            else {
                return Err("you already have the latest version".into());
            };
            update
                .download_and_install(|_, _| {}, || {})
                .await
                .map_err(|e| format!("update failed: {e}"))
        })
    }
}

fn blob_response(app: &AppHandle, req: &Request<Vec<u8>>) -> BoxFut<Response<Vec<u8>>> {
    let app = app.clone();
    let hash = blob::hash_from_uri(req.uri().host(), req.uri().path());
    let range = req
        .headers()
        .get("range")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let origin = req
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    Box::pin(async move {
        let plain = |status: u16| {
            Response::builder()
                .status(status)
                .body(Vec::new())
                .expect("static response")
        };
        let (Some(hash), Some(ctx)) = (hash, app.try_state::<Arc<Ctx>>()) else {
            return plain(404);
        };
        let r = blob::serve(&ctx, &hash, range.as_deref()).await;
        let mut b = Response::builder().status(r.status);
        for (k, v) in r.headers(origin.as_deref()) {
            b = b.header(k, v);
        }
        b.body(r.body).unwrap_or_else(|_| plain(500))
    })
}

pub fn run() {
    let builder = shell::plugins(tauri::Builder::<Wry>::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::LogDir {
                        file_name: Some(LOG_FILE.into()),
                    }),
                    Target::new(TargetKind::Stdout),
                ])
                .max_file_size(LOG_MAX_BYTES)
                .rotation_strategy(RotationStrategy::KeepSome(LOG_KEEP))
                .build(),
        )
        .register_asynchronous_uri_scheme_protocol("hermod-blob", |c, req, responder| {
            let fut = blob_response(c.app_handle(), &req);
            tauri::async_runtime::spawn(async move { responder.respond(fut.await) });
        })
        .invoke_handler(|invoke| {
            let cmd = invoke.message.command().to_string();
            if cmd.starts_with("plugin:") {
                return false;
            }
            let payload = invoke.message.payload().clone();
            let meta = invoke
                .message
                .headers()
                .get(api::RAW_ARGS_HEADER)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);
            let app = invoke.message.webview().app_handle().clone();
            invoke.resolver.respond_async(async move {
                let Some(ctx) = app.try_state::<Arc<Ctx>>().map(|s| s.inner().clone()) else {
                    return Err(InvokeError::from("Hermod is still starting".to_string()));
                };
                let out = match payload {
                    InvokeBody::Json(args) => api::handle(&ctx, &cmd, args).await,
                    InvokeBody::Raw(bytes) => {
                        api::handle_raw(&ctx, &cmd, meta.as_deref(), bytes).await
                    }
                };
                out.map_err(InvokeError::from)
            });
            true
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let log_file = app
                .path()
                .app_log_dir()
                .ok()
                .map(|d| d.join(format!("{LOG_FILE}.log")));
            let shell_impl: Arc<dyn Shell> = Arc::new(TauriShell(app.handle().clone()));
            let ctx = tauri::async_runtime::block_on(Ctx::open(
                dir,
                Options::production(log_file),
                Some(shell_impl),
            ))?;
            let mut rx = ctx.subscribe();
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(ev) => {
                            let _ = handle.emit(&ev.name, ev.payload);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                        Err(_) => break,
                    }
                }
            });
            app.manage(ctx);
            shell::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let keep = window
                    .app_handle()
                    .try_state::<Arc<Ctx>>()
                    .is_some_and(|c| c.background());
                if keep {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });
    let app = builder
        .build(crate::web_assets::install(tauri::generate_context!()))
        .expect("error while building tauri application");
    app.run(|handle, event| {
        if let RunEvent::Exit = event
            && let Some(ctx) = handle.try_state::<Arc<Ctx>>()
        {
            tauri::async_runtime::block_on(ctx.shutdown());
        }
    });
}
