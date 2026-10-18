//! Frontend assets: the Next export is embedded, the large `/assets/` and `/basis/` folders ship as bundle
//! resources under `web/` (see scripts/split-web-assets.mjs) and are read from disk under the same URLs.

use std::borrow::Cow;
use std::path::PathBuf;

use tauri::utils::assets::{AssetKey, AssetsIter, CspHash, EmbeddedAssets};
use tauri::{Assets, Context, Wry};

struct WebAssets {
    embedded: Box<dyn Assets<Wry>>,
    dir: Option<PathBuf>,
}

/// Maps an asset key to a file under `dir`, refusing anything that could escape it.
fn resource_path(dir: &std::path::Path, key: &str) -> Option<PathBuf> {
    let rel = key.strip_prefix('/')?;
    let safe = !rel.is_empty()
        && rel
            .split('/')
            .all(|s| !s.is_empty() && s != "." && s != ".." && !s.contains(['\\', ':']));
    safe.then(|| dir.join(rel))
}

impl Assets<Wry> for WebAssets {
    fn setup(&self, app: &tauri::App<Wry>) {
        self.embedded.setup(app)
    }

    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        self.embedded.get(key).or_else(|| {
            let path = resource_path(self.dir.as_deref()?, key.as_ref())?;
            std::fs::read(path).ok().map(Cow::Owned)
        })
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.embedded.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        self.embedded.csp_hashes(html_path)
    }
}

/// Wraps the embedded assets so misses fall through to `<resource dir>/web/`.
pub fn install(mut ctx: Context<Wry>) -> Context<Wry> {
    let dir = tauri::utils::platform::resource_dir(ctx.package_info(), &tauri::Env::default())
        .ok()
        .map(|d| d.join("web"));
    if dir.is_none() {
        log::warn!("resource dir unavailable: /assets/ and /basis/ will not load");
    }
    let empty = EmbeddedAssets::new(Default::default(), &[], Default::default());
    let embedded = ctx.set_assets(Box::new(empty));
    ctx.set_assets(Box::new(WebAssets { embedded, dir }));
    ctx
}

#[cfg(test)]
mod tests {
    use super::resource_path;
    use std::path::Path;

    #[test]
    fn resource_path_stays_inside_dir() {
        let d = Path::new("/r/web");
        assert_eq!(
            resource_path(d, "/assets/a.glb"),
            Some(d.join("assets/a.glb"))
        );
        for bad in [
            "/../x",
            "/assets/../../x",
            "/a//b",
            "/",
            "assets/a",
            "/a\\..\\b",
            "/C:/x",
            "/./a",
        ] {
            assert_eq!(resource_path(d, bad), None, "{bad}");
        }
    }
}
