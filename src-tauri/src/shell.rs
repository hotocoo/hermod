//! Desktop shell: deep links, single instance, tray.
use std::sync::Arc;

#[cfg(any(target_os = "macos", test))]
use tauri::menu::AboutMetadata;
#[cfg(target_os = "macos")]
use tauri::menu::SubmenuBuilder;
use tauri::{
    AppHandle, Manager, Wry,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::ctx::Ctx;

pub const TRAY_ID: &str = "main";
const APP_NAME: &str = "Hermod";
#[cfg(any(target_os = "macos", test))]
const APP_COPYRIGHT: &str = "Copyright 2026 The Hermod contributors";
#[cfg(any(target_os = "macos", test))]
const APP_LICENSE: &str = "Apache-2.0";
#[cfg(any(target_os = "macos", test))]
const APP_WEBSITE: &str = "https://hotocoo.github.io/hermod/";
#[cfg(target_os = "macos")]
const MENU_EDIT: &str = "Edit";
#[cfg(target_os = "macos")]
const MENU_WINDOW: &str = "Window";
const LINK_SCHEME: &str = "hermod://";

#[cfg(any(target_os = "macos", test))]
/// What the About panel shows; the version always comes from the package, never a literal.
pub fn about_metadata(version: &str) -> AboutMetadata<'static> {
    AboutMetadata {
        name: Some(APP_NAME.into()),
        version: Some(version.into()),
        copyright: Some(APP_COPYRIGHT.into()),
        license: Some(APP_LICENSE.into()),
        website: Some(APP_WEBSITE.into()),
        ..Default::default()
    }
}

/// macOS menu bar: app menu with About, standard Edit (so copy/paste keys work in the webview)
/// and Window menus.
#[cfg(target_os = "macos")]
fn app_menu(app: &tauri::App) -> tauri::Result<Menu<Wry>> {
    let about = about_metadata(&app.package_info().version.to_string());
    let app_sub = SubmenuBuilder::new(app, APP_NAME)
        .about(Some(about))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, MENU_EDIT)
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window = SubmenuBuilder::new(app, MENU_WINDOW)
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;
    Menu::with_items(app, &[&app_sub, &edit, &window])
}

/// argv of a second launch: the first entry is the program, the rest that are `hermod://`
/// links are forwarded to the running app; anything else is ignored.
pub fn link_args(args: &[String]) -> impl Iterator<Item = &str> {
    args.iter()
        .skip(1)
        .map(String::as_str)
        .filter(|a| a.starts_with(LINK_SCHEME))
}

/// Whether closing the window hides it (keep helping the network) instead of quitting. The
/// app not being ready yet counts as quitting.
pub fn close_hides(background: Option<bool>) -> bool {
    background.unwrap_or(false)
}

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
            for a in link_args(&args) {
                emit_code(app, a);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
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

    #[cfg(target_os = "macos")]
    app.set_menu(app_menu(app)?)?;

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
    use super::{about_metadata, close_hides, link_args, tray_tooltip};
    use crate::ctx::invite_code;

    #[test]
    fn about_carries_the_package_version() {
        let a = about_metadata(env!("CARGO_PKG_VERSION"));
        assert_eq!(a.version.as_deref(), Some(env!("CARGO_PKG_VERSION")));
        assert_eq!(a.name.as_deref(), Some("Hermod"));
    }

    #[test]
    fn second_launch_forwards_only_links() {
        let argv = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let a = argv(&[
            "/app/hermod",
            "hermod://join/abc",
            "--flag",
            "https://x",
            "hermod://join/d",
        ]);
        assert_eq!(
            link_args(&a).collect::<Vec<_>>(),
            ["hermod://join/abc", "hermod://join/d"]
        );
        let only_program = argv(&["hermod://join/abc"]);
        assert_eq!(
            link_args(&only_program).count(),
            0,
            "argv[0] is never a link"
        );
        assert_eq!(link_args(&[]).count(), 0);
    }

    #[test]
    fn closing_hides_only_when_background_is_on() {
        assert!(close_hides(Some(true)));
        assert!(!close_hides(Some(false)));
        assert!(!close_hides(None));
    }

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
