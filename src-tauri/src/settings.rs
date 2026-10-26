//! Device-local settings (never in the event log): node resource caps, notification rules,
//! blocked users. Stored as small JSON values in `Core`'s settings table.

use hermod_core::Core;
use hermod_core::event::MAX_BODY_BYTES;
use hermod_core::ratelimit::RateConfig;
use hermod_node::config::{CEIL_CONNECTIONS, CEIL_RELAY_BPS, CEIL_RELAY_CIRCUITS, Limits};
use serde::{Deserialize, Serialize};

pub const MIB: u64 = 1024 * 1024;
pub const GIB: u64 = 1024 * MIB;
/// Ceiling for bytes relayed per circuit (ARCHITECTURE section 7).
pub const CEIL_BYTES_PER_CIRCUIT: u64 = 512 * MIB;
/// Ceiling for the blob cache size.
pub const CEIL_BLOB_CACHE: u64 = 4 * GIB;
const MIN_CONNECTIONS: u32 = 8;
/// Ceilings for the per-author gossip caps (E-010): sustained events per second and burst.
/// Kept below the node's inbound backstop (`EVENT_IN_RATE`) so a user cap is never pre-empted.
pub const CEIL_EVENT_RATE: u32 = 50;
pub const CEIL_EVENT_BURST: u32 = 200;
/// Smallest event body the size cap may be set to.
const MIN_EVENT_BYTES: u64 = 1024;

const NODE_KEY: &str = "node_settings";
const NOTIFY_KEY: &str = "notify_settings";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeSettings {
    pub relay_paused: bool,
    pub relay_circuits: u32,
    pub relay_bandwidth_bps: u64,
    pub relay_bytes_per_circuit: u64,
    pub blob_cache_bytes: u64,
    pub max_connections: u32,
    /// Per-author live-gossip cap: sustained events per second, burst, and bytes per event.
    pub event_rate_per_sec: u32,
    pub event_burst: u32,
    pub max_event_bytes: u64,
    /// Keep the node running when the window is closed (tray mode).
    pub background: bool,
}

/// Stored form: every field optional so a new default never rewrites an old choice.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NodePatch {
    pub relay_paused: Option<bool>,
    pub relay_circuits: Option<u32>,
    pub relay_bandwidth_bps: Option<u64>,
    pub relay_bytes_per_circuit: Option<u64>,
    pub blob_cache_bytes: Option<u64>,
    pub max_connections: Option<u32>,
    pub event_rate_per_sec: Option<u32>,
    pub event_burst: Option<u32>,
    pub max_event_bytes: Option<u64>,
    pub background: Option<bool>,
}

impl NodeSettings {
    pub fn defaults(share_resources: bool) -> Self {
        let l = Limits::default();
        let r = RateConfig::default();
        NodeSettings {
            relay_paused: !share_resources,
            relay_circuits: l.relay_circuits,
            relay_bandwidth_bps: l.relay_bandwidth_bps,
            relay_bytes_per_circuit: l.relay_bytes_per_circuit,
            blob_cache_bytes: 512 * MIB,
            max_connections: l.max_connections,
            event_rate_per_sec: r.events_per_sec as u32,
            event_burst: r.burst,
            max_event_bytes: r.max_event_bytes as u64,
            background: false,
        }
    }

    /// Apply a patch, clamping every value to its hard ceiling.
    pub fn apply(mut self, p: &NodePatch) -> Self {
        if let Some(v) = p.relay_paused {
            self.relay_paused = v;
        }
        if let Some(v) = p.relay_circuits {
            self.relay_circuits = v.min(CEIL_RELAY_CIRCUITS);
        }
        if let Some(v) = p.relay_bandwidth_bps {
            self.relay_bandwidth_bps = v.clamp(1, CEIL_RELAY_BPS);
        }
        if let Some(v) = p.relay_bytes_per_circuit {
            self.relay_bytes_per_circuit = v.clamp(MIB, CEIL_BYTES_PER_CIRCUIT);
        }
        if let Some(v) = p.blob_cache_bytes {
            self.blob_cache_bytes = v.min(CEIL_BLOB_CACHE);
        }
        if let Some(v) = p.max_connections {
            self.max_connections = v.clamp(MIN_CONNECTIONS, CEIL_CONNECTIONS);
        }
        if let Some(v) = p.event_rate_per_sec {
            self.event_rate_per_sec = v.clamp(1, CEIL_EVENT_RATE);
        }
        if let Some(v) = p.event_burst {
            self.event_burst = v.clamp(1, CEIL_EVENT_BURST);
        }
        if let Some(v) = p.max_event_bytes {
            self.max_event_bytes = v.clamp(MIN_EVENT_BYTES, MAX_BODY_BYTES as u64);
        }
        if let Some(v) = p.background {
            self.background = v;
        }
        self
    }

    /// Live-gossip caps handed to the store.
    pub fn rate(&self) -> RateConfig {
        RateConfig {
            events_per_sec: f64::from(self.event_rate_per_sec),
            burst: self.event_burst,
            max_event_bytes: self.max_event_bytes as usize,
        }
    }

    pub fn limits(&self) -> Limits {
        Limits {
            relay_circuits: self.relay_circuits,
            relay_bandwidth_bps: self.relay_bandwidth_bps,
            relay_bytes_per_circuit: self.relay_bytes_per_circuit,
            max_connections: self.max_connections,
            relay_paused: self.relay_paused,
            ..Limits::default()
        }
        .clamped()
    }

    pub fn ceilings() -> serde_json::Value {
        serde_json::json!({
            "relay_circuits": CEIL_RELAY_CIRCUITS,
            "relay_bandwidth_bps": CEIL_RELAY_BPS,
            "relay_bytes_per_circuit": CEIL_BYTES_PER_CIRCUIT,
            "blob_cache_bytes": CEIL_BLOB_CACHE,
            "max_connections": CEIL_CONNECTIONS,
            "event_rate_per_sec": CEIL_EVENT_RATE,
            "event_burst": CEIL_EVENT_BURST,
            "max_event_bytes": MAX_BODY_BYTES,
        })
    }
}

pub fn node_settings(core: &Core) -> Result<NodeSettings, String> {
    let share = core
        .legal_status()
        .map_err(|e| e.to_string())?
        .share_resources;
    let patch: NodePatch = match core.setting_get(NODE_KEY).map_err(|e| e.to_string())? {
        Some(s) => serde_json::from_str(&s).unwrap_or_default(),
        None => NodePatch::default(),
    };
    Ok(NodeSettings::defaults(share).apply(&patch))
}

/// Merge `patch` into the stored choices and return the effective settings.
pub fn node_settings_set(core: &Core, patch: &NodePatch) -> Result<NodeSettings, String> {
    let mut stored: NodePatch = match core.setting_get(NODE_KEY).map_err(|e| e.to_string())? {
        Some(s) => serde_json::from_str(&s).unwrap_or_default(),
        None => NodePatch::default(),
    };
    macro_rules! merge {
        ($($f:ident),*) => { $( if patch.$f.is_some() { stored.$f = patch.$f; } )* };
    }
    merge!(
        relay_paused,
        relay_circuits,
        relay_bandwidth_bps,
        relay_bytes_per_circuit,
        blob_cache_bytes,
        max_connections,
        event_rate_per_sec,
        event_burst,
        max_event_bytes,
        background
    );
    let json = serde_json::to_string(&stored).map_err(|e| e.to_string())?;
    core.setting_set(NODE_KEY, &json)
        .map_err(|e| e.to_string())?;
    node_settings(core)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DndSchedule {
    pub enabled: bool,
    pub from_hour: u8,
    pub to_hour: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotifySettings {
    pub enabled: bool,
    pub dm: bool,
    pub mention: bool,
    pub meeting: bool,
    pub reminder: bool,
    pub muted_spaces: Vec<String>,
    pub muted_channels: Vec<String>,
    pub dnd_until: Option<i64>,
    pub dnd_schedule: DndSchedule,
}

impl Default for NotifySettings {
    fn default() -> Self {
        NotifySettings {
            enabled: true,
            dm: true,
            mention: true,
            meeting: true,
            reminder: true,
            muted_spaces: Vec::new(),
            muted_channels: Vec::new(),
            dnd_until: None,
            dnd_schedule: DndSchedule {
                enabled: false,
                from_hour: 22,
                to_hour: 7,
            },
        }
    }
}

const MAX_MUTES: usize = 40;

impl NotifySettings {
    /// Merge a partial JSON object over the current values; unknown keys are rejected.
    pub fn patched(&self, patch: &serde_json::Value) -> Result<Self, String> {
        let mut cur = serde_json::to_value(self).map_err(|e| e.to_string())?;
        let (Some(obj), Some(p)) = (cur.as_object_mut(), patch.as_object()) else {
            return Err("notification settings must be an object".into());
        };
        for (k, v) in p {
            if !obj.contains_key(k) {
                return Err(format!("unknown notification setting: {k}"));
            }
            obj.insert(k.clone(), v.clone());
        }
        let next: NotifySettings = serde_json::from_value(cur)
            .map_err(|e| format!("invalid notification settings: {e}"))?;
        if next.muted_spaces.len() > MAX_MUTES
            || next.muted_channels.len() > MAX_MUTES
            || next.dnd_schedule.from_hour > 23
            || next.dnd_schedule.to_hour > 23
        {
            return Err("too many muted items or bad hour".into());
        }
        Ok(next)
    }

    /// True when `now_ms` falls inside a do-not-disturb period (manual or scheduled).
    pub fn dnd_active(&self, now_ms: i64, tz_offset_secs: i32) -> bool {
        if let Some(until) = self.dnd_until {
            let until_ms = if until > 100_000_000_000 {
                until
            } else {
                until * 1000
            };
            if now_ms < until_ms {
                return true;
            }
        }
        let s = &self.dnd_schedule;
        if !s.enabled {
            return false;
        }
        let local_secs = now_ms.div_euclid(1000) + i64::from(tz_offset_secs);
        let hour = (local_secs.rem_euclid(86_400) / 3600) as u8;
        if s.from_hour == s.to_hour {
            false
        } else if s.from_hour < s.to_hour {
            hour >= s.from_hour && hour < s.to_hour
        } else {
            hour >= s.from_hour || hour < s.to_hour
        }
    }

    pub fn muted(&self, space_label: &str, channel: &str) -> bool {
        self.muted_spaces.iter().any(|s| s == space_label)
            || self
                .muted_channels
                .iter()
                .any(|c| *c == format!("{space_label}/{channel}"))
    }
}

pub fn notify_settings(core: &Core) -> Result<NotifySettings, String> {
    match core.setting_get(NOTIFY_KEY).map_err(|e| e.to_string())? {
        Some(s) => serde_json::from_str(&s)
            .map_err(|e| format!("stored notification settings are corrupt: {e}")),
        None => Ok(NotifySettings::default()),
    }
}

pub fn notify_settings_set(
    core: &Core,
    patch: &serde_json::Value,
) -> Result<NotifySettings, String> {
    let next = notify_settings(core)?.patched(patch)?;
    let json = serde_json::to_string(&next).map_err(|e| e.to_string())?;
    core.setting_set(NOTIFY_KEY, &json)
        .map_err(|e| e.to_string())?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patch_clamps_to_ceilings() {
        let s = NodeSettings::defaults(true).apply(&NodePatch {
            relay_circuits: Some(10_000),
            relay_bandwidth_bps: Some(u64::MAX),
            max_connections: Some(1),
            blob_cache_bytes: Some(u64::MAX),
            ..NodePatch::default()
        });
        assert_eq!(s.relay_circuits, CEIL_RELAY_CIRCUITS);
        assert_eq!(s.relay_bandwidth_bps, CEIL_RELAY_BPS);
        assert_eq!(s.max_connections, MIN_CONNECTIONS);
        assert_eq!(s.blob_cache_bytes, CEIL_BLOB_CACHE);
        assert!(!s.relay_paused);
        assert!(NodeSettings::defaults(false).relay_paused);
    }

    #[test]
    fn event_caps_default_to_core_and_clamp() {
        let d = NodeSettings::defaults(true);
        assert_eq!(d.rate(), RateConfig::default());
        let s = d.apply(&NodePatch {
            event_rate_per_sec: Some(0),
            event_burst: Some(u32::MAX),
            max_event_bytes: Some(u64::MAX),
            ..NodePatch::default()
        });
        assert_eq!(s.event_rate_per_sec, 1);
        assert_eq!(s.event_burst, CEIL_EVENT_BURST);
        assert_eq!(s.max_event_bytes, MAX_BODY_BYTES as u64);
    }

    #[test]
    fn event_ceilings_stay_below_the_node_backstop() {
        use hermod_node::proto::EVENT_IN_RATE;
        assert!(f64::from(CEIL_EVENT_RATE) < EVENT_IN_RATE.0);
        assert!(f64::from(CEIL_EVENT_BURST) < EVENT_IN_RATE.1);
    }

    #[test]
    fn dnd_window_wraps_midnight() {
        let mut n = NotifySettings {
            dnd_schedule: DndSchedule {
                enabled: true,
                from_hour: 22,
                to_hour: 7,
            },
            ..NotifySettings::default()
        };
        let at = |h: i64| h * 3_600_000;
        assert!(n.dnd_active(at(23), 0));
        assert!(n.dnd_active(at(3), 0));
        assert!(!n.dnd_active(at(12), 0));
        assert!(
            n.dnd_active(at(12), 11 * 3600),
            "tz offset shifts the local hour to 23"
        );
        n.dnd_until = Some(at(14));
        assert!(n.dnd_active(at(13), 0));
    }

    #[test]
    fn notify_patch_rejects_unknown_keys() {
        let n = NotifySettings::default();
        assert!(n.patched(&serde_json::json!({"nope": true})).is_err());
        let p = n
            .patched(&serde_json::json!({"dm": false, "muted_spaces": ["abc"]}))
            .unwrap();
        assert!(!p.dm && p.muted("abc", "general") && !p.muted("x", "general"));
    }
}
