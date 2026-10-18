//! Desktop shell: deep links, single instance, tray.
use tauri::{
    AppHandle, Emitter, Manager, Wry,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_deep_link::DeepLinkExt;

const SCHEME_PREFIX: &str = "hermod://join/";

/// `hermod://join/<code>` to `<code>`. Codes are base58, so anything else is rejected.
fn invite_code(url: &str) -> Option<&str> {
    let code = url.strip_prefix(SCHEME_PREFIX)?.trim_end_matches('/');
    (!code.is_empty() && code.chars().all(|c| c.is_ascii_alphanumeric())).then_some(code)
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn emit_code(app: &AppHandle, url: &str) {
    if let Some(code) = invite_code(url) {
        show_main(app);
        let _ = app.emit("hermod://deeplink", serde_json::json!({ "code": code }));
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
    let mut tray = TrayIconBuilder::new()
        .tooltip("Hermod")
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
    use super::invite_code;

    #[test]
    fn parses_codes() {
        assert_eq!(invite_code("hermod://join/3mJr7AoU"), Some("3mJr7AoU"));
        assert_eq!(invite_code("hermod://join/abc/"), Some("abc"));
        assert_eq!(invite_code("hermod://join/"), None);
        assert_eq!(invite_code("https://join/abc"), None);
        assert_eq!(invite_code("hermod://join/a b"), None);
    }
}
