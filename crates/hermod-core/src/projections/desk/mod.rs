//! Help Desk fold (contract section 11.1): tickets, comments, links, merges, CSAT, macros, views.
//!
//! The fold runs in `(lamport, author, seq)` order inside the space fold, so ticket numbers and
//! every other outcome are identical on every peer. Role rules live here: guests only create
//! tickets, comment on their own tickets and rate them; everything else needs `member`, and only
//! admins write `desk.config` (the last is enforced by `min_role`). Visibility is applied when the
//! view is rendered for one viewer, so a guest never receives other people's tickets or internal
//! notes in the projection. Guests hold the space key, so this is projection-level isolation, not
//! cryptographic separation.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};

use super::sla::Hours;
use super::state::Ord3;
use crate::event::{
    BlobRef, BusinessHoursIn, DeskFieldIn, DeskQueueIn, DeskSlaIn, EventBody, MacroActionIn, Role,
    ViewFilterIn,
};

pub const STATUSES: [&str; 6] = ["new", "open", "pending", "on_hold", "solved", "closed"];
pub const PRIORITIES: [&str; 4] = ["low", "normal", "high", "urgent"];
const LINK_KINDS: [&str; 4] = ["duplicate", "relates", "blocks", "child"];
const FIELD_KINDS: [&str; 5] = ["text", "number", "select", "date", "checkbox"];

const MAX_ID: usize = 128;
const MAX_SUBJECT: usize = 200;
const MAX_BODY: usize = 20_000;
const MAX_TAGS: usize = 30;
const MAX_TAG: usize = 40;
const MAX_QUEUES: usize = 50;
const MAX_FIELDS: usize = 50;
const MAX_FIELD_VALUE: usize = 2_000;
const MAX_MACROS: usize = 200;
const MAX_VIEWS: usize = 200;
const MAX_ACTIONS: usize = 20;
const MAX_ATTACHMENTS: usize = 20;
const MIN_MS: i64 = 60_000;

fn clip(s: &str, max: usize) -> String {
    s.trim().chars().take(max).collect()
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= MAX_ID && !s.chars().any(char::is_control)
}

fn is_terminal(status: &str) -> bool {
    status == "solved" || status == "closed"
}

/// Pausing statuses stop the resolve clock; `new` and `open` run it.
fn is_running(status: &str) -> bool {
    status == "new" || status == "open"
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeskConfigView {
    pub queues: Vec<DeskQueueIn>,
    pub fields: Vec<DeskFieldIn>,
    pub sla: Vec<DeskSlaIn>,
    pub business_hours: Option<BusinessHoursIn>,
    pub csat: bool,
}

struct CommentSt {
    id: String,
    ticket: String,
    by: String,
    ts: i64,
    ord: Ord3,
    body: String,
    internal: bool,
    att: Vec<BlobRef>,
}

struct LinkSt {
    kind: String,
    target: String,
    by: String,
    ts: i64,
}

struct CsatSt {
    score: u8,
    comment: String,
    ts: i64,
}

struct TicketSt {
    id: String,
    number: u32,
    subject: String,
    body: String,
    status: String,
    priority: String,
    queue: String,
    requester: String,
    assignee: Option<String>,
    /// Who last set the assignee (so a self-assignment never notifies the assigner).
    assigned_by: Option<String>,
    tags: BTreeSet<String>,
    fields: BTreeMap<String, String>,
    created: i64,
    updated: i64,
    due: Option<i64>,
    att: Vec<BlobRef>,
    comments: Vec<CommentSt>,
    links: Vec<LinkSt>,
    csat: Option<CsatSt>,
    merged_into: Option<String>,
    first_reply: Option<i64>,
    solved_at: Option<i64>,
    /// `(ts, running)` transitions of the resolve clock, starting at creation.
    clock: Vec<(i64, bool)>,
}

impl TicketSt {
    /// Event time that never runs backwards for this ticket.
    fn stamp(&self, ts: i64) -> i64 {
        ts.max(self.updated)
    }

    fn set_status(&mut self, status: &str, ts: i64) {
        if self.status == status {
            return;
        }
        let was = is_running(&self.status);
        self.status = status.to_string();
        let now = is_running(status);
        if was != now {
            self.clock.push((ts, now));
        }
        if !is_terminal(status) {
            self.solved_at = None;
        } else if self.solved_at.is_none() {
            self.solved_at = Some(ts);
        }
    }

    fn running_now(&self) -> bool {
        self.clock.last().is_some_and(|c| c.1)
    }

    fn intervals(&self) -> Vec<(i64, Option<i64>)> {
        let mut out: Vec<(i64, Option<i64>)> = Vec::new();
        for (ts, run) in &self.clock {
            match (run, out.last_mut()) {
                (true, Some((_, None))) => {}
                (true, _) => out.push((*ts, None)),
                (false, Some(last @ (_, None))) => last.1 = Some(*ts),
                (false, _) => {}
            }
        }
        out
    }
}

struct MacroSt {
    id: String,
    name: String,
    by: String,
    actions: Vec<MacroActionIn>,
}

struct ViewSt {
    id: String,
    name: String,
    by: String,
    filter: ViewFilterIn,
    sort: String,
    shared: bool,
}

#[derive(Default)]
pub struct DeskState {
    config: DeskConfigView,
    hours: Option<Hours>,
    tickets: Vec<TicketSt>,
    index: HashMap<String, usize>,
    macros: Vec<MacroSt>,
    views: Vec<ViewSt>,
}

fn csat_default() -> DeskConfigView {
    DeskConfigView {
        csat: true,
        ..DeskConfigView::default()
    }
}

fn norm_tag(t: &str) -> Option<String> {
    let t = clip(t, MAX_TAG).to_lowercase();
    (!t.is_empty()).then_some(t)
}

impl DeskState {
    pub fn new() -> Self {
        DeskState {
            config: csat_default(),
            ..DeskState::default()
        }
    }

    /// Tickets created so far (drives the Counting House level).
    pub fn count(&self) -> u32 {
        self.tickets.len() as u32
    }

    fn default_queue(&self) -> String {
        self.config
            .queues
            .first()
            .map(|q| q.queue_id.clone())
            .unwrap_or_default()
    }

    fn queue_ok(&self, id: &str) -> bool {
        self.config.queues.iter().any(|q| q.queue_id == id)
    }

    fn field(&self, id: &str) -> Option<&DeskFieldIn> {
        self.config.fields.iter().find(|f| f.field_id == id)
    }

    /// Keeps only configured fields with values their kind accepts.
    fn clean_fields(&self, input: &BTreeMap<String, String>) -> BTreeMap<String, String> {
        input
            .iter()
            .filter_map(|(k, v)| {
                let f = self.field(k)?;
                let v = clip(v, MAX_FIELD_VALUE);
                let ok = match f.kind.as_str() {
                    "number" => v.is_empty() || v.parse::<f64>().is_ok_and(f64::is_finite),
                    "select" => v.is_empty() || f.options.contains(&v),
                    "checkbox" => v == "true" || v == "false" || v.is_empty(),
                    _ => true,
                };
                ok.then(|| (k.clone(), v))
            })
            .collect()
    }

    fn missing_required(&self, fields: &BTreeMap<String, String>) -> bool {
        self.config.fields.iter().any(|f| {
            f.required
                && f.kind != "checkbox"
                && fields.get(&f.field_id).is_none_or(|v| v.is_empty())
        })
    }

    fn ticket_mut(&mut self, id: &str) -> Option<&mut TicketSt> {
        let i = *self.index.get(id)?;
        self.tickets.get_mut(i)
    }

    /// Applies one authorized event. `roles` is the space's role table at this point of the fold.
    pub fn apply(
        &mut self,
        ts: i64,
        by: &str,
        roles: &BTreeMap<String, Role>,
        ord: Ord3,
        body: &EventBody,
    ) {
        let agent = roles.get(by).is_some_and(|r| *r >= Role::Member);
        match body {
            EventBody::DeskConfig {
                queues,
                fields,
                sla,
                business_hours,
                csat,
            } => self.set_config(queues, fields, sla, business_hours.as_ref(), *csat),
            EventBody::TicketCreate {
                ticket_id,
                queue_id,
                subject,
                body,
                priority,
                fields,
                attachments,
            } => self.create(
                ts,
                by,
                ticket_id,
                queue_id,
                subject,
                body,
                priority,
                fields,
                attachments,
            ),
            EventBody::TicketUpdate { ticket_id, .. } if agent => {
                self.update(ts, by, roles, ticket_id, body);
            }
            EventBody::TicketComment {
                ticket_id,
                comment_id,
                body,
                internal,
                attachments,
            } => self.comment(
                ts,
                by,
                agent,
                ord,
                ticket_id,
                comment_id,
                body,
                *internal,
                attachments,
            ),
            EventBody::TicketLink {
                ticket_id,
                kind,
                target,
            } if agent => self.link(ts, by, ticket_id, kind, target),
            EventBody::TicketMerge { ticket_id, into } if agent => self.merge(ts, ticket_id, into),
            EventBody::TicketCsat {
                ticket_id,
                score,
                comment,
            } => self.rate(ts, by, ticket_id, *score, comment.as_deref()),
            EventBody::DeskMacro {
                macro_id,
                name,
                actions,
                deleted,
            } if agent => {
                let admin = roles.get(by).is_some_and(|r| *r >= Role::Admin);
                self.set_macro(by, admin, macro_id, name, actions, *deleted);
            }
            EventBody::DeskView {
                view_id,
                name,
                filter,
                sort,
                shared,
                deleted,
            } if agent => self.set_view(by, view_id, name, filter, sort, *shared, *deleted),
            _ => {}
        }
    }

    fn set_config(
        &mut self,
        queues: &[DeskQueueIn],
        fields: &[DeskFieldIn],
        slas: &[DeskSlaIn],
        hours: Option<&BusinessHoursIn>,
        csat: bool,
    ) {
        let mut seen = BTreeSet::new();
        let queues: Vec<DeskQueueIn> = queues
            .iter()
            .filter(|q| valid_id(&q.queue_id) && !q.name.trim().is_empty())
            .filter(|q| seen.insert(q.queue_id.clone()))
            .take(MAX_QUEUES)
            .map(|q| DeskQueueIn {
                queue_id: q.queue_id.clone(),
                name: clip(&q.name, 80),
                desc: clip(&q.desc, 400),
            })
            .collect();
        let mut seen = BTreeSet::new();
        let fields: Vec<DeskFieldIn> = fields
            .iter()
            .filter(|f| valid_id(&f.field_id) && !f.label.trim().is_empty())
            .filter(|f| FIELD_KINDS.contains(&f.kind.as_str()))
            .filter(|f| seen.insert(f.field_id.clone()))
            .take(MAX_FIELDS)
            .map(|f| DeskFieldIn {
                field_id: f.field_id.clone(),
                label: clip(&f.label, 80),
                kind: f.kind.clone(),
                options: f.options.iter().map(|o| clip(o, 80)).take(50).collect(),
                required: f.required,
            })
            .collect();
        let mut seen = BTreeSet::new();
        let slas: Vec<DeskSlaIn> = slas
            .iter()
            .filter(|s| PRIORITIES.contains(&s.priority.as_str()))
            .filter(|s| s.first_response_mins > 0 && s.resolve_mins > 0)
            .filter(|s| seen.insert(s.priority.clone()))
            .cloned()
            .collect();
        let hours = hours.filter(|h| Hours::from_event(h).is_some());
        self.hours = hours.and_then(Hours::from_event);
        self.config = DeskConfigView {
            queues,
            fields,
            sla: slas,
            business_hours: hours.cloned(),
            csat,
        };
    }

    #[allow(clippy::too_many_arguments)]
    fn create(
        &mut self,
        ts: i64,
        by: &str,
        id: &str,
        queue: &str,
        subject: &str,
        body: &str,
        priority: &str,
        fields: &BTreeMap<String, String>,
        att: &[BlobRef],
    ) {
        let subject = clip(subject, MAX_SUBJECT);
        if !valid_id(id) || subject.is_empty() || self.index.contains_key(id) {
            return;
        }
        let fields = self.clean_fields(fields);
        if self.missing_required(&fields) {
            return;
        }
        let queue = if self.queue_ok(queue) {
            queue.to_string()
        } else {
            self.default_queue()
        };
        let priority = if PRIORITIES.contains(&priority) {
            priority
        } else {
            "normal"
        };
        let number = self.tickets.len() as u32 + 1;
        self.index.insert(id.to_string(), self.tickets.len());
        self.tickets.push(TicketSt {
            id: id.to_string(),
            number,
            subject,
            body: clip(body, MAX_BODY),
            status: "new".into(),
            priority: priority.to_string(),
            queue,
            requester: by.to_string(),
            assignee: None,
            assigned_by: None,
            tags: BTreeSet::new(),
            fields,
            created: ts,
            updated: ts,
            due: None,
            att: att.iter().take(MAX_ATTACHMENTS).cloned().collect(),
            comments: Vec::new(),
            links: Vec::new(),
            csat: None,
            merged_into: None,
            first_reply: None,
            solved_at: None,
            clock: vec![(ts, true)],
        });
    }

    fn update(
        &mut self,
        ts: i64,
        by: &str,
        roles: &BTreeMap<String, Role>,
        id: &str,
        body: &EventBody,
    ) {
        let EventBody::TicketUpdate {
            status,
            priority,
            queue_id,
            assignee,
            tags_add,
            tags_remove,
            fields,
            due,
            ..
        } = body
        else {
            return;
        };
        let fields = self.clean_fields(fields);
        let queue = queue_id.as_ref().filter(|q| self.queue_ok(q)).cloned();
        let Some(t) = self.ticket_mut(id) else { return };
        if t.merged_into.is_some() {
            return;
        }
        let ts = t.stamp(ts);
        if let Some(s) = status.as_deref().filter(|s| STATUSES.contains(s)) {
            t.set_status(s, ts);
        }
        if let Some(p) = priority.as_deref().filter(|p| PRIORITIES.contains(p)) {
            t.priority = p.to_string();
        }
        if let Some(q) = queue {
            t.queue = q;
        }
        match assignee.as_deref() {
            Some("") => {
                t.assignee = None;
                t.assigned_by = None;
            }
            Some(a) if roles.get(a).is_some_and(|r| *r >= Role::Member) => {
                if t.assignee.as_deref() != Some(a) {
                    t.assigned_by = Some(by.to_string());
                }
                t.assignee = Some(a.to_string());
            }
            _ => {}
        }
        for tag in tags_remove.iter().filter_map(|x| norm_tag(x)) {
            t.tags.remove(&tag);
        }
        for tag in tags_add.iter().filter_map(|x| norm_tag(x)) {
            if t.tags.len() < MAX_TAGS {
                t.tags.insert(tag);
            }
        }
        t.fields.extend(fields);
        t.fields.retain(|_, v| !v.is_empty());
        match due {
            Some(0) => t.due = None,
            Some(d) if *d > 0 => t.due = Some(*d),
            _ => {}
        }
        t.updated = ts;
    }

    #[allow(clippy::too_many_arguments)]
    fn comment(
        &mut self,
        ts: i64,
        by: &str,
        agent: bool,
        ord: Ord3,
        ticket: &str,
        id: &str,
        body: &str,
        internal: bool,
        att: &[BlobRef],
    ) {
        let body = clip(body, MAX_BODY);
        let att: Vec<BlobRef> = att.iter().take(MAX_ATTACHMENTS).cloned().collect();
        if !valid_id(id) || (body.is_empty() && att.is_empty()) {
            return;
        }
        let Some(t) = self.ticket_mut(ticket) else {
            return;
        };
        let requester = t.requester == by;
        // Guests only reach their own tickets; internal notes are for agents.
        if t.merged_into.is_some() || (!agent && !requester) {
            return;
        }
        let internal = internal && agent;
        if t.comments.iter().any(|c| c.id == id) || (t.status == "closed" && !internal) {
            return;
        }
        let ts = t.stamp(ts);
        if !internal {
            if requester {
                if matches!(t.status.as_str(), "pending" | "on_hold" | "solved") {
                    t.set_status("open", ts);
                }
            } else {
                t.first_reply.get_or_insert(ts);
                if t.status == "new" {
                    t.set_status("open", ts);
                }
            }
        }
        t.comments.push(CommentSt {
            id: id.to_string(),
            ticket: ticket.to_string(),
            by: by.to_string(),
            ts,
            ord,
            body,
            internal,
            att,
        });
        t.updated = ts;
    }

    fn link(&mut self, ts: i64, by: &str, id: &str, kind: &str, target: &str) {
        if !LINK_KINDS.contains(&kind) || !valid_id(target) || target == id {
            return;
        }
        let Some(t) = self.ticket_mut(id) else { return };
        if t.links.iter().any(|l| l.kind == kind && l.target == target) {
            return;
        }
        t.links.push(LinkSt {
            kind: kind.to_string(),
            target: target.to_string(),
            by: by.to_string(),
            ts,
        });
        t.updated = t.stamp(ts);
    }

    fn merge(&mut self, ts: i64, id: &str, into: &str) {
        if id == into {
            return;
        }
        let (Some(&a), Some(&b)) = (self.index.get(id), self.index.get(into)) else {
            return;
        };
        if self.tickets[a].merged_into.is_some() || self.tickets[b].merged_into.is_some() {
            return;
        }
        let ts = self.tickets[a].stamp(ts);
        let src = &mut self.tickets[a];
        src.set_status("closed", ts);
        src.merged_into = Some(into.to_string());
        src.updated = ts;
        for t in &mut self.tickets {
            if t.merged_into.as_deref() == Some(id) {
                t.merged_into = Some(into.to_string());
            }
        }
        let dst = &mut self.tickets[b];
        dst.updated = dst.updated.max(ts);
    }

    fn rate(&mut self, ts: i64, by: &str, id: &str, score: u8, comment: Option<&str>) {
        if !(1..=5).contains(&score) || !self.config.csat {
            return;
        }
        let Some(t) = self.ticket_mut(id) else { return };
        if t.requester != by || t.merged_into.is_some() || !is_terminal(&t.status) {
            return;
        }
        t.csat = Some(CsatSt {
            score,
            comment: clip(comment.unwrap_or(""), 1000),
            ts,
        });
        t.updated = t.stamp(ts);
    }

    fn set_macro(
        &mut self,
        by: &str,
        admin: bool,
        id: &str,
        name: &str,
        actions: &[MacroActionIn],
        del: bool,
    ) {
        if !valid_id(id) {
            return;
        }
        let pos = self.macros.iter().position(|m| m.id == id);
        // Only the author or an admin may change or delete a macro.
        if pos.is_some_and(|i| self.macros[i].by != by && !admin) {
            return;
        }
        if del {
            if let Some(i) = pos {
                self.macros.remove(i);
            }
            return;
        }
        let name = clip(name, 80);
        if name.is_empty() || (pos.is_none() && self.macros.len() >= MAX_MACROS) {
            return;
        }
        let m = MacroSt {
            id: id.to_string(),
            name,
            by: by.to_string(),
            actions: actions.iter().take(MAX_ACTIONS).cloned().collect(),
        };
        match pos {
            Some(i) => self.macros[i] = m,
            None => self.macros.push(m),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn set_view(
        &mut self,
        by: &str,
        id: &str,
        name: &str,
        filter: &ViewFilterIn,
        sort: &str,
        shared: bool,
        del: bool,
    ) {
        if !valid_id(id) {
            return;
        }
        let pos = self.views.iter().position(|v| v.id == id);
        // Only the author may change or delete a view.
        if pos.is_some_and(|i| self.views[i].by != by) {
            return;
        }
        if del {
            if let Some(i) = pos {
                self.views.remove(i);
            }
            return;
        }
        let name = clip(name, 80);
        if name.is_empty() || (pos.is_none() && self.views.len() >= MAX_VIEWS) {
            return;
        }
        let v = ViewSt {
            id: id.to_string(),
            name,
            by: by.to_string(),
            filter: filter.clone(),
            sort: clip(sort, 40),
            shared,
        };
        match pos {
            Some(i) => self.views[i] = v,
            None => self.views.push(v),
        }
    }
}

mod view;

pub use view::*;
