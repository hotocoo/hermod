//! Per-viewer rendering of the desk: visibility rules, SLA views, stats and search rows.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use super::{CommentSt, DeskConfigView, DeskState, MIN_MS, TicketSt, is_terminal};
use crate::event::{BlobRef, MacroActionIn, Role, ViewFilterIn};
use crate::projections::sla;

// ---- rendering for one viewer ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommentView {
    pub id: String,
    /// Ticket the comment was written on (differs from the shown ticket after a merge).
    pub ticket: String,
    pub by: String,
    pub ts: i64,
    pub body: String,
    pub internal: bool,
    pub att: Vec<BlobRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkView {
    pub kind: String,
    pub target: String,
    /// Number of the target when it is a ticket of this space.
    pub number: Option<u32>,
    /// The link points at this ticket (shown on the other side of a ticket link).
    pub inverse: bool,
    pub by: String,
    pub ts: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CsatView {
    pub score: u8,
    pub comment: String,
    pub ts: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlaView {
    pub first_due: i64,
    pub resolve_due: Option<i64>,
    pub first_responded: Option<i64>,
    pub resolved_at: Option<i64>,
    /// The resolve clock is paused by the status (pending or on hold).
    pub paused: bool,
    /// A target was missed at some point.
    pub breached: bool,
    /// A target is missed right now and still unmet.
    pub overdue: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketView {
    pub id: String,
    pub number: u32,
    pub subject: String,
    pub body: String,
    pub status: String,
    pub priority: String,
    pub queue: String,
    pub requester: String,
    pub assignee: Option<String>,
    pub assigned_by: Option<String>,
    pub tags: Vec<String>,
    pub fields: BTreeMap<String, String>,
    pub created: i64,
    pub updated: i64,
    pub due: Option<i64>,
    pub att: Vec<BlobRef>,
    pub comments: Vec<CommentView>,
    pub links: Vec<LinkView>,
    pub csat: Option<CsatView>,
    pub merged_into: Option<String>,
    pub merged_from: Vec<String>,
    pub sla: Option<SlaView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MacroView {
    pub id: String,
    pub name: String,
    pub by: String,
    pub actions: Vec<MacroActionIn>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedView {
    pub id: String,
    pub name: String,
    pub by: String,
    pub filter: ViewFilterIn,
    pub sort: String,
    pub shared: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct DeskStats {
    pub open: u32,
    pub overdue: u32,
    pub by_status: BTreeMap<String, u32>,
    /// Open tickets per assignee; unassigned ones under `""`.
    pub by_assignee: BTreeMap<String, u32>,
    pub median_first_response_ms: Option<i64>,
    pub csat_avg: Option<f64>,
    pub csat_count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeskView {
    pub config: DeskConfigView,
    pub agent: bool,
    pub admin: bool,
    /// Members who can take tickets (role member or above), for the assignee picker.
    pub agents: Vec<String>,
    pub tickets: Vec<TicketView>,
    pub views: Vec<SavedView>,
    pub macros: Vec<MacroView>,
    pub stats: Option<DeskStats>,
}

fn sla_for(d: &DeskState, t: &TicketSt, now: i64) -> Option<SlaView> {
    let p = d.config.sla.iter().find(|s| s.priority == t.priority)?;
    let h = d.hours.as_ref();
    let first_due = sla::add_open_ms(h, t.created, i64::from(p.first_response_mins) * MIN_MS);
    let first_end = t.first_reply.or(t.solved_at);
    let first_missed = first_end.is_some_and(|e| e > first_due);
    let first_overdue = first_end.is_none() && now > first_due;
    let iv = t.intervals();
    let target = i64::from(p.resolve_mins) * MIN_MS;
    let resolve_due = sla::due_over(h, &iv, target);
    let terminal = is_terminal(&t.status);
    let ran_until = iv.last().and_then(|x| x.1);
    let (resolve_missed, resolve_overdue) = match resolve_due {
        None => (false, false),
        Some(due) if terminal => (ran_until.is_some_and(|end| due < end), false),
        Some(due) => (now > due, now > due),
    };
    Some(SlaView {
        first_due,
        resolve_due,
        first_responded: t.first_reply,
        resolved_at: t.solved_at,
        paused: !terminal && !t.running_now(),
        breached: first_missed || first_overdue || resolve_missed,
        overdue: first_overdue || resolve_overdue,
    })
}

fn median(mut v: Vec<i64>) -> Option<i64> {
    if v.is_empty() {
        return None;
    }
    v.sort_unstable();
    let n = v.len();
    Some(if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2
    })
}

impl DeskState {
    /// Tickets a viewer may see: agents all, everyone else their own.
    fn visible<'a>(&'a self, me: &str, agent: bool) -> impl Iterator<Item = &'a TicketSt> + 'a {
        let me = me.to_string();
        self.tickets
            .iter()
            .filter(move |t| agent || t.requester == me)
    }

    fn ticket_view(&self, t: &TicketSt, me: &str, agent: bool, now: i64) -> TicketView {
        let mut comments: Vec<&CommentSt> = t.comments.iter().collect();
        let mut merged_from = Vec::new();
        for s in self
            .tickets
            .iter()
            .filter(|s| s.merged_into.as_deref() == Some(t.id.as_str()))
        {
            merged_from.push(s.id.clone());
            // A guest only sees the comments of their own merged ticket.
            if agent || s.requester == me {
                comments.extend(s.comments.iter());
            }
        }
        comments.sort_by_key(|c| c.ord);
        let numbers: HashMap<&str, u32> = self
            .tickets
            .iter()
            .map(|x| (x.id.as_str(), x.number))
            .collect();
        let mut links: Vec<LinkView> = Vec::new();
        if agent {
            links.extend(t.links.iter().map(|l| LinkView {
                kind: l.kind.clone(),
                target: l.target.clone(),
                number: numbers.get(l.target.as_str()).copied(),
                inverse: false,
                by: l.by.clone(),
                ts: l.ts,
            }));
            for o in &self.tickets {
                links.extend(
                    o.links
                        .iter()
                        .filter(|l| l.target == t.id)
                        .map(|l| LinkView {
                            kind: l.kind.clone(),
                            target: o.id.clone(),
                            number: Some(o.number),
                            inverse: true,
                            by: l.by.clone(),
                            ts: l.ts,
                        }),
                );
            }
        }
        TicketView {
            id: t.id.clone(),
            number: t.number,
            subject: t.subject.clone(),
            body: t.body.clone(),
            status: t.status.clone(),
            priority: t.priority.clone(),
            queue: t.queue.clone(),
            requester: t.requester.clone(),
            assignee: t.assignee.clone(),
            assigned_by: if agent { t.assigned_by.clone() } else { None },
            tags: if agent {
                t.tags.iter().cloned().collect()
            } else {
                Vec::new()
            },
            fields: t.fields.clone(),
            created: t.created,
            updated: t.updated,
            due: t.due.filter(|_| agent),
            att: t.att.clone(),
            comments: comments
                .into_iter()
                .filter(|c| agent || !c.internal)
                .map(|c| CommentView {
                    id: c.id.clone(),
                    ticket: c.ticket.clone(),
                    by: c.by.clone(),
                    ts: c.ts,
                    body: c.body.clone(),
                    internal: c.internal,
                    att: c.att.clone(),
                })
                .collect(),
            links,
            csat: t.csat.as_ref().map(|c| CsatView {
                score: c.score,
                comment: c.comment.clone(),
                ts: c.ts,
            }),
            merged_into: t.merged_into.clone(),
            merged_from,
            sla: if agent { sla_for(self, t, now) } else { None },
        }
    }

    fn stats(&self, now: i64) -> DeskStats {
        let mut st = DeskStats::default();
        let mut firsts = Vec::new();
        let mut scores = Vec::new();
        for t in self.tickets.iter().filter(|t| t.merged_into.is_none()) {
            *st.by_status.entry(t.status.clone()).or_default() += 1;
            if !is_terminal(&t.status) {
                st.open += 1;
                *st.by_assignee
                    .entry(t.assignee.clone().unwrap_or_default())
                    .or_default() += 1;
                if sla_for(self, t, now).is_some_and(|s| s.overdue) {
                    st.overdue += 1;
                }
            }
            if let Some(r) = t.first_reply {
                firsts.push(r - t.created);
            }
            if let Some(c) = &t.csat {
                scores.push(f64::from(c.score));
            }
        }
        st.median_first_response_ms = median(firsts);
        st.csat_count = scores.len() as u32;
        st.csat_avg = (!scores.is_empty()).then(|| {
            let avg = scores.iter().sum::<f64>() / scores.len() as f64;
            (avg * 100.0).round() / 100.0
        });
        st
    }

    /// The projection for one viewer. `None` when the viewer is not a member of the space.
    pub fn render(&self, me: &str, roles: &BTreeMap<String, Role>, now: i64) -> Option<DeskView> {
        let role = roles.get(me).copied();
        let role = role?;
        let agent = role >= Role::Member;
        let mut config = self.config.clone();
        if !agent {
            config.sla.clear();
            config.business_hours = None;
        }
        Some(DeskView {
            config,
            agent,
            admin: role >= Role::Admin,
            agents: if agent {
                roles
                    .iter()
                    .filter(|(_, r)| **r >= Role::Member)
                    .map(|(u, _)| u.clone())
                    .collect()
            } else {
                Vec::new()
            },
            tickets: self
                .visible(me, agent)
                .map(|t| self.ticket_view(t, me, agent, now))
                .collect(),
            views: if agent {
                self.views
                    .iter()
                    .filter(|v| v.shared || v.by == me)
                    .map(|v| SavedView {
                        id: v.id.clone(),
                        name: v.name.clone(),
                        by: v.by.clone(),
                        filter: v.filter.clone(),
                        sort: v.sort.clone(),
                        shared: v.shared,
                    })
                    .collect()
            } else {
                Vec::new()
            },
            macros: if agent {
                self.macros
                    .iter()
                    .map(|m| MacroView {
                        id: m.id.clone(),
                        name: m.name.clone(),
                        by: m.by.clone(),
                        actions: m.actions.clone(),
                    })
                    .collect()
            } else {
                Vec::new()
            },
            stats: agent.then(|| self.stats(now)),
        })
    }

    /// Search rows for one viewer: subject, body and visible comments of every visible ticket.
    pub fn search_rows(&self, me: &str, role: Option<Role>) -> Vec<DeskSearchRow> {
        let Some(role) = role else { return Vec::new() };
        let agent = role >= Role::Member;
        self.visible(me, agent)
            .map(|t| {
                let mut text = format!("#{} {} {}", t.number, t.subject, t.body);
                for c in t.comments.iter().filter(|c| agent || !c.internal) {
                    text.push(' ');
                    text.push_str(&c.body);
                }
                if agent {
                    for tag in &t.tags {
                        text.push(' ');
                        text.push_str(tag);
                    }
                }
                DeskSearchRow {
                    id: t.id.clone(),
                    author: t.requester.clone(),
                    ts: t.updated,
                    text,
                }
            })
            .collect()
    }
}

pub struct DeskSearchRow {
    pub id: String,
    pub author: String,
    pub ts: i64,
    pub text: String,
}
