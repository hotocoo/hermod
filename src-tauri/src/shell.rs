//! Desktop shell: deep links, single instance, tray.
use std::sync::Arc;

use tauri::{
    AppHandle, Manager, Wry,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::ctx::Ctx;

pub const TRAY_ID: &str = "main";
const APP_NAME: &str = "Hermod";

/// Tray tooltip: the app name, plus the unread total when there is one.
pub fn tray_tooltip(unread: u32) -> String {
    if unread == 0 {
        APP_NAME.into()
    } else {
        format!("{APP_NAME} ({unread} unread)")
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Hand a join link to the UI through `Ctx`, which also keeps it for a webview that is not
/// listening yet (cold start).
fn emit_code(app: &AppHandle, url: &str) {
    let Some(ctx) = app.try_state::<Arc<Ctx>>() else {
        tracing::warn!("deep link before the app finished starting");
        return;
    };
    if ctx.open_link(url) {
        show_main(app);
    }
}

/// Register plugins. Single-instance must be first.
pub fn plugins(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    builder
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main(app);
            for a in args.iter().skip(1) {
                emit_code(app, a);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle().clone();
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for u in urls {
            emit_code(&handle, u.as_str());
        }
    }
    app.deep_link().on_open_url(move |e| {
        for u in e.urls() {
            emit_code(&handle, u.as_str());
        }
    });
    // Dev runs are not bundled, so register the scheme at runtime.
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    let _ = app.deep_link().register_all();

    let show = MenuItem::with_id(app, "show", "Show Hermod", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(APP_NAME)
        .menu(&menu)
        .on_menu_event(|app, ev| match ev.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::tray_tooltip;
    use crate::ctx::invite_code;

    #[test]
    fn tooltip_shows_unread() {
        assert_eq!(tray_tooltip(0), "Hermod");
        assert_eq!(tray_tooltip(3), "Hermod (3 unread)");
    }

    #[test]
    fn parses_codes() {
        assert_eq!(invite_code("hermod://join/3mJr7AoU"), Some("3mJr7AoU"));
        assert_eq!(invite_code("hermod://join/abc/"), Some("abc"));
        assert_eq!(invite_code("hermod://join/"), None);
        assert_eq!(invite_code("https://join/abc"), None);
        assert_eq!(invite_code("hermod://join/a b"), None);
    }
}
