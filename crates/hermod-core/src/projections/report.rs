//! Governance and search views of one space: members and roles, invites, audit log, reports, and
//! the items that feed the full-text index. Same fold as the snapshot, so they always agree.

use serde::{Deserialize, Serialize};

use super::state::{AuditEntry, SpaceState};
use super::{ProjectionCtx, SpaceInput};
use crate::event::Role;
use crate::ids::SpaceId;
use crate::search::SearchItem;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberInfo {
    pub user: String,
    pub name: String,
    pub role: Role,
    pub joined_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InviteInfo {
    pub id: String,
    pub by: String,
    pub role: Role,
    pub created_at: i64,
    pub exp: Option<u64>,
    pub max_uses: Option<u32>,
    pub uses: u32,
    pub revoked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReportInfo {
    pub id: String,
    pub by: String,
    pub target: String,
    pub reason: String,
    pub ts: i64,
    /// `message` or `post`; empty when the target is gone or unknown.
    pub target_kind: String,
    pub target_by: String,
    pub target_text: String,
    /// Channel of a reported message, for jumping to it.
    pub channel: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpaceReport {
    pub space: SpaceId,
    pub my_role: Option<Role>,
    /// The local user was removed by an admin.
    pub removed: bool,
    /// Highest key epoch announced by an authorized `space.rekey`.
    pub max_epoch: u32,
    pub members: Vec<MemberInfo>,
    pub invites: Vec<InviteInfo>,
    pub audit: Vec<AuditEntry>,
    pub reports: Vec<ReportInfo>,
}

fn fold(input: &SpaceInput) -> SpaceState {
    super::fold_input(input)
}

/// Members, invites, audit log and reports. Admin-only parts are returned as folded; callers
/// decide who may see them (see `Core::audit_list`).
pub fn report(ctx: &ProjectionCtx, input: &SpaceInput) -> SpaceReport {
    let s = fold(input);
    let me = ctx.me.to_string();
    let mut members: Vec<MemberInfo> = s
        .roles
        .iter()
        .map(|(user, role)| MemberInfo {
            user: user.clone(),
            name: s
                .profiles
                .get(user)
                .map(|p| p.name.clone())
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| user.chars().take(8).collect()),
            role: *role,
            joined_at: s.joined_ts.get(user).copied().unwrap_or(0),
        })
        .collect();
    members.sort_by(|a, b| {
        b.role
            .cmp(&a.role)
            .then(a.joined_at.cmp(&b.joined_at))
            .then_with(|| a.user.cmp(&b.user))
    });
    SpaceReport {
        space: s.id,
        my_role: s.role_of(&me),
        removed: s.banned.contains(&me),
        max_epoch: s.max_epoch,
        members,
        invites: s
            .invites
            .iter()
            .map(|i| InviteInfo {
                id: i.id.clone(),
                by: i.by.clone(),
                role: i.role,
                created_at: i.ts,
                exp: i.exp,
                max_uses: i.max_uses,
                uses: i.uses.len() as u32,
                revoked: i.revoked,
            })
            .collect(),
        audit: s.audit.clone(),
        reports: s
            .reports
            .iter()
            .filter(|r| r.resolved.is_none())
            .map(|r| {
                let (kind, by, text, channel) = s.report_target(&r.target).unwrap_or_default();
                ReportInfo {
                    id: r.id.clone(),
                    by: r.by.clone(),
                    target: r.target.clone(),
                    reason: r.reason.clone(),
                    ts: r.ts,
                    target_kind: kind.to_string(),
                    target_by: by,
                    target_text: text,
                    channel,
                }
            })
            .collect(),
    }
}

/// Everything searchable in one space: live messages, posts, docs, cards, snaps and events.
pub fn search_items(me: &str, input: &SpaceInput) -> Vec<SearchItem> {
    let s = fold(input);
    let mut out = Vec::new();
    for (ch, list) in &s.msgs {
        for m in list
            .iter()
            .filter(|m| m.removed.is_none() && m.by != "system")
        {
            let mut text = m.text.clone();
            for r in &m.thread {
                text.push(' ');
                text.push_str(&r.text);
            }
            out.push(SearchItem {
                kind: "message",
                id: m.id.clone(),
                author: m.by.clone(),
                ts: m.ts,
                channel: ch.clone(),
                text,
            });
        }
    }
    for p in s.posts.iter().filter(|p| !p.removed) {
        let text = format!("{} {}", p.title, p.text.as_deref().unwrap_or(""));
        out.push(SearchItem {
            kind: "post",
            id: p.id.clone(),
            author: p.by.clone(),
            ts: p.ts,
            channel: String::new(),
            text,
        });
    }
    for d in &s.docs {
        let mut text = format!("{} {}", d.title, d.kicker);
        for b in &d.blocks {
            text.push(' ');
            text.push_str(&b.text);
        }
        out.push(SearchItem {
            kind: "doc",
            id: d.id.clone(),
            author: d.last_edit.1.clone(),
            ts: d.last_edit.0,
            channel: String::new(),
            text,
        });
    }
    for c in s.boards.iter().flat_map(|b| &b.cols).flat_map(|c| &c.cards) {
        out.push(SearchItem {
            kind: "card",
            id: c.id.clone(),
            author: c.by.clone(),
            ts: c.ts,
            channel: String::new(),
            text: format!("{} {}", c.title, c.tag),
        });
    }
    for x in s.snaps.iter().filter(|x| x.weave_of.is_none()) {
        let paths: Vec<&str> = x.files.iter().map(|f| f.path.as_str()).collect();
        out.push(SearchItem {
            kind: "snap",
            id: x.id.clone(),
            author: x.by.clone(),
            ts: x.ts,
            channel: String::new(),
            text: format!("{} {}", x.title, paths.join(" ")),
        });
    }
    for e in &s.cal {
        out.push(SearchItem {
            kind: "event",
            id: e.id.clone(),
            author: e.by.clone(),
            ts: 0,
            channel: String::new(),
            text: format!("{} {} {}", e.title, e.note, e.place),
        });
    }
    for r in s.desk.search_rows(me, s.role_of(me)) {
        out.push(SearchItem {
            kind: "ticket",
            id: r.id,
            author: r.author,
            ts: r.ts,
            channel: String::new(),
            text: r.text,
        });
    }
    out
}
