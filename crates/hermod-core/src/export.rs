//! Space export (D-006): a folder of plain JSON plus the space's files, readable without Hermod.
//!
//! Read-only: the export is built from the projections (what the member sees, removed and
//! past-retention content excluded) and never touches the log or blob store. It refuses a
//! non-empty target so it can never overwrite someone's files.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::Path;

use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::api::Core;
use crate::error::{Error, Result};
use crate::ids::SpaceId;

const MESSAGES_FILE: &str = "messages.json";
const POSTS_FILE: &str = "posts.json";
const DOCS_FILE: &str = "docs.json";
const BOARD_FILE: &str = "board.json";
const MEMBERS_FILE: &str = "members.json";
const FILES_DIR: &str = "files";
const FILES_INDEX: &str = "index.json";
const HOME_LABEL: &str = "home";
/// Hash characters kept in an exported file name (the index maps them back to the full hash).
const NAME_HASH_CHARS: usize = 12;
/// Longest sanitised display name kept in an exported file name.
const NAME_MAX_CHARS: usize = 80;

/// What an export wrote.
#[derive(Debug, Clone, Serialize)]
pub struct ExportSummary {
    pub messages: usize,
    pub files: usize,
    /// Blobs the space references but this device does not hold completely (not exported).
    pub missing: Vec<String>,
}

/// File-name-safe form of an untrusted peer-supplied name: no separators, no leading dots.
fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || "._-".contains(c) {
                c
            } else {
                '_'
            }
        })
        .take(NAME_MAX_CHARS)
        .collect();
    cleaned.trim_start_matches('.').to_string()
}

/// Every blob-shaped object (`hash` and `mime` keys) anywhere in `v`: hash -> (name, mime, size).
fn collect_blobs(v: &Value, out: &mut BTreeMap<String, (String, String, u64)>) {
    match v {
        Value::Object(m) => {
            if let (Some(Value::String(h)), true) = (m.get("hash"), m.contains_key("mime")) {
                let text = |k: &str| {
                    m.get(k)
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string()
                };
                let size = m.get("size").and_then(Value::as_u64).unwrap_or(0);
                out.entry(h.clone())
                    .or_insert_with(|| (text("name"), text("mime"), size));
            }
            m.values().for_each(|c| collect_blobs(c, out));
        }
        Value::Array(a) => a.iter().for_each(|c| collect_blobs(c, out)),
        _ => {}
    }
}

fn write_json(dir: &Path, name: &str, v: &Value) -> Result<()> {
    let mut f = fs::File::create(dir.join(name))?;
    f.write_all(serde_json::to_string_pretty(v)?.as_bytes())?;
    f.sync_all()?;
    Ok(())
}

impl Core {
    /// Writes `messages.json`, `posts.json`, `docs.json`, `board.json`, `members.json`,
    /// `files/` (blobs plus `index.json`) of one space into `dir`. `dir` must be absent or empty.
    pub fn space_export(&self, space: &SpaceId, dir: &Path) -> Result<ExportSummary> {
        let is_home = self.lock().row(space)?.is_home;
        let label = if is_home {
            HOME_LABEL.to_string()
        } else {
            space.to_string()
        };
        if dir.exists() && fs::read_dir(dir)?.next().is_some() {
            return Err(Error::invalid("export", "the target folder is not empty"));
        }
        let snap = self.snapshot()?;
        let col = &snap["collections"];
        let chan_prefix = format!("{label}/");
        let mut messages = Map::new();
        for (k, v) in col["messages"].as_object().into_iter().flatten() {
            if let Some(ch) = k.strip_prefix(&chan_prefix) {
                messages.insert(ch.to_string(), v.clone());
            }
        }
        let in_space = |v: &&Value| v["spaceId"] == label;
        let docs: Vec<&Value> = col["docs"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(in_space)
            .collect();
        let pinboards: Vec<&Value> = col["pinboards"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(in_space)
            .collect();
        let message_count = messages
            .values()
            .filter_map(Value::as_array)
            .map(Vec::len)
            .sum();
        let parts = [
            (MESSAGES_FILE, Value::Object(messages)),
            (POSTS_FILE, col["feed"][&label].clone()),
            (DOCS_FILE, json!(docs)),
            (
                BOARD_FILE,
                json!({ "workboard": col["workboards"][&label], "pinboards": pinboards }),
            ),
            (MEMBERS_FILE, serde_json::to_value(self.members(space)?)?),
        ];
        fs::create_dir_all(dir)?;
        let mut blobs = BTreeMap::new();
        for (name, v) in &parts {
            collect_blobs(v, &mut blobs);
            write_json(dir, name, v)?;
        }
        let files_dir = dir.join(FILES_DIR);
        fs::create_dir_all(&files_dir)?;
        let (mut index, mut missing) = (Map::new(), Vec::new());
        for (hash, (name, mime, size)) in &blobs {
            let Some(m) = self
                .blobs()
                .manifest(hash)?
                .filter(|m| self.blobs().has_all_chunks(m))
            else {
                missing.push(hash.clone());
                continue;
            };
            let short: String = hash.chars().take(NAME_HASH_CHARS).collect();
            let file = format!("{short}-{}", safe_name(name));
            let mut out = fs::File::create(files_dir.join(&file))?;
            for i in 0..m.chunks.len() {
                out.write_all(&self.blobs().read_chunk_in(&m, hash, i as u32)?)?;
            }
            out.sync_all()?;
            index.insert(
                hash.clone(),
                json!({ "file": file, "name": name, "mime": mime, "size": size }),
            );
        }
        write_json(&files_dir, FILES_INDEX, &Value::Object(index.clone()))?;
        Ok(ExportSummary {
            messages: message_count,
            files: index.len(),
            missing,
        })
    }
}
