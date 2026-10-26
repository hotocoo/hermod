mod common;

use std::collections::BTreeMap;

use common::*;
use hermod_core::event::{
    BusinessHoursIn, DeskFieldIn, DeskQueueIn, DeskSlaIn, EventBody, MacroActionIn, Role,
};
use hermod_core::identity::Identity;
use hermod_core::ids::{SpaceId, UserId};
use hermod_core::projections::desk::DeskView;
use hermod_core::projections::{project, search_items};

struct Desk {
    log: Log,
    sid: SpaceId,
    owner: UserId,
    agent: UserId,
    g1: UserId,
    g2: UserId,
    _ids: Vec<Identity>,
}

fn invite_as(id: &str, role: Role) -> EventBody {
    EventBody::InviteCreate {
        id: id.into(),
        exp: None,
        max_uses: None,
        role,
    }
}

fn join_via(id: &str) -> EventBody {
    EventBody::MemberJoin {
        via_invite_from: None,
        pow: None,
        invite: Some(id.into()),
    }
}

/// Space with an owner, one agent (member) and two guests (customers).
fn desk() -> Desk {
    let (i0, owner) = user();
    let (i1, agent) = user();
    let (i2, g1) = user();
    let (i3, g2) = user();
    let mut log = Log::new();
    let t = NOW - 10 * DAY;
    log.push(&owner, t, space_create("Acme", &["chat", "desk"]));
    log.push(&owner, t, invite_as("m", Role::Member));
    log.push(&owner, t, invite_as("g", Role::Guest));
    log.push(&agent, t, join_via("m"));
    log.push(&g1, t, join_via("g"));
    log.push(&g2, t, join_via("g"));
    Desk {
        log,
        sid: SpaceId([9; 32]),
        owner,
        agent,
        g1,
        g2,
        _ids: vec![i0, i1, i2, i3],
    }
}

fn view(d: &Desk, me: UserId) -> Option<DeskView> {
    let snap = project(&ctx(me), &[d.log.input(d.sid, "Acme", "Team", false)]);
    snap.collections.desk.into_values().next()
}

fn create(id: &str, subject: &str) -> EventBody {
    EventBody::TicketCreate {
        ticket_id: id.into(),
        queue_id: String::new(),
        subject: subject.into(),
        body: format!("body of {subject}"),
        priority: "normal".into(),
        fields: BTreeMap::new(),
        attachments: vec![],
    }
}

fn comment(ticket: &str, id: &str, body: &str, internal: bool) -> EventBody {
    EventBody::TicketComment {
        ticket_id: ticket.into(),
        comment_id: id.into(),
        body: body.into(),
        internal,
        attachments: vec![],
    }
}

fn update(ticket: &str) -> EventBody {
    EventBody::TicketUpdate {
        ticket_id: ticket.into(),
        status: None,
        priority: None,
        queue_id: None,
        assignee: None,
        tags_add: vec![],
        tags_remove: vec![],
        fields: BTreeMap::new(),
        due: None,
    }
}

fn set_status(ticket: &str, status: &str) -> EventBody {
    match update(ticket) {
        EventBody::TicketUpdate {
            ticket_id,
            priority,
            queue_id,
            assignee,
            tags_add,
            tags_remove,
            fields,
            due,
            ..
        } => EventBody::TicketUpdate {
            ticket_id,
            status: Some(status.into()),
            priority,
            queue_id,
            assignee,
            tags_add,
            tags_remove,
            fields,
            due,
        },
        _ => unreachable!(),
    }
}

fn ticket<'a>(v: &'a DeskView, id: &str) -> &'a hermod_core::projections::desk::TicketView {
    v.tickets.iter().find(|t| t.id == id).unwrap()
}

#[test]
fn guests_only_see_their_own_tickets_and_no_internal_notes() {
    let mut d = desk();
    let (a, g1, g2) = (d.agent, d.g1, d.g2);
    d.log
        .push(&g1, NOW - 5 * HOUR, create("t1", "printer broken"));
    d.log
        .push(&g2, NOW - 4 * HOUR, create("t2", "invoice wrong"));
    d.log.push(
        &a,
        NOW - 3 * HOUR,
        comment("t1", "c1", "secret agent note", true),
    );
    d.log.push(
        &a,
        NOW - 2 * HOUR,
        comment("t1", "c2", "try rebooting", false),
    );
    let mut up = update("t1");
    if let EventBody::TicketUpdate { tags_add, .. } = &mut up {
        tags_add.push("Hardware".into());
    }
    d.log.push(&a, NOW - HOUR, up);

    let gv = view(&d, g1).unwrap();
    assert!(!gv.agent && gv.stats.is_none() && gv.macros.is_empty() && gv.views.is_empty());
    assert_eq!(gv.tickets.len(), 1);
    let t = ticket(&gv, "t1");
    assert_eq!(t.comments.len(), 1, "internal note hidden");
    assert_eq!(t.comments[0].body, "try rebooting");
    assert!(t.tags.is_empty() && t.sla.is_none() && t.links.is_empty());
    let g2v = view(&d, g2).unwrap();
    assert_eq!(g2v.tickets.len(), 1);
    assert_eq!(g2v.tickets[0].id, "t2");

    let av = view(&d, a).unwrap();
    assert_eq!(av.tickets.len(), 2);
    assert_eq!(ticket(&av, "t1").comments.len(), 2);
    assert_eq!(ticket(&av, "t1").tags, vec!["hardware"]);
    assert_eq!(av.stats.as_ref().unwrap().open, 2);
}

#[test]
fn guests_cannot_touch_other_tickets_or_staff_actions() {
    let mut d = desk();
    let (a, g1, g2) = (d.agent, d.g1, d.g2);
    d.log.push(&g1, NOW - 5 * HOUR, create("t1", "mine"));
    // g2 comments on g1's ticket: ignored. g1 flags a comment internal: forced public.
    d.log
        .push(&g2, NOW - 4 * HOUR, comment("t1", "x", "intruder", false));
    d.log
        .push(&g1, NOW - 4 * HOUR, comment("t1", "y", "more info", true));
    // Guests cannot update, link, merge, make macros or write config.
    d.log.push(&g1, NOW - 3 * HOUR, set_status("t1", "solved"));
    d.log.push(
        &g1,
        NOW - 3 * HOUR,
        EventBody::TicketLink {
            ticket_id: "t1".into(),
            kind: "relates".into(),
            target: "m1".into(),
        },
    );
    d.log.push(
        &g1,
        NOW - 3 * HOUR,
        EventBody::DeskMacro {
            macro_id: "mac".into(),
            name: "x".into(),
            actions: vec![],
            deleted: false,
        },
    );
    d.log.push(&g1, NOW - 3 * HOUR, config(vec![], false, true));
    // A member cannot write config; admins can.
    d.log.push(&a, NOW - 2 * HOUR, config(vec![], false, false));
    let av = view(&d, a).unwrap();
    assert!(
        av.config.csat,
        "member config ignored, default csat stays on"
    );
    let t = ticket(&av, "t1");
    assert_eq!(t.status, "new");
    assert_eq!(t.comments.len(), 1);
    assert!(!t.comments[0].internal);
    assert!(t.links.is_empty() && av.macros.is_empty());
    d.log
        .push(&d.owner, NOW - HOUR, config(vec![], false, false));
    assert!(!view(&d, a).unwrap().config.csat);
}

fn config(sla: Vec<DeskSlaIn>, hours: bool, csat: bool) -> EventBody {
    EventBody::DeskConfig {
        queues: vec![DeskQueueIn {
            queue_id: "support".into(),
            name: "Support".into(),
            desc: String::new(),
        }],
        fields: vec![DeskFieldIn {
            field_id: "os".into(),
            label: "OS".into(),
            kind: "select".into(),
            options: vec!["mac".into(), "win".into()],
            required: false,
        }],
        sla,
        business_hours: hours.then(|| BusinessHoursIn {
            tz: "+08:00".into(),
            days: vec![1, 2, 3, 4, 5],
            start: 540,
            end: 1020,
        }),
        csat,
    }
}

#[test]
fn ticket_numbers_are_deterministic_under_shuffled_ingest() {
    let mut d = desk();
    let (a, g1, g2) = (d.agent, d.g1, d.g2);
    d.log.push(&g1, NOW - 5 * HOUR, create("zeta", "one"));
    d.log.push(&g2, NOW - 4 * HOUR, create("alpha", "two"));
    d.log.push(&g1, NOW - 3 * HOUR, create("mid", "three"));
    d.log
        .push(&a, NOW - 2 * HOUR, comment("alpha", "c", "hello", false));
    let base = view(&d, a).unwrap();
    let numbers: Vec<(String, u32)> = base
        .tickets
        .iter()
        .map(|t| (t.id.clone(), t.number))
        .collect();
    assert_eq!(
        numbers,
        vec![("zeta".into(), 1), ("alpha".into(), 2), ("mid".into(), 3)]
    );
    let full = serde_json::to_string(&base).unwrap();
    for shift in 1..d.log.events.len() {
        let mut s = d.log.events.clone();
        s.rotate_left(shift);
        let mut r = d.log.events.clone();
        r.reverse();
        for evs in [s, r] {
            let mut input = d.log.input(d.sid, "Acme", "Team", false);
            input.events = evs.into();
            let snap = project(&ctx(a), &[input]);
            let got = serde_json::to_string(&snap.collections.desk.into_values().next().unwrap())
                .unwrap();
            assert_eq!(got, full);
        }
    }
}

#[test]
fn sla_uses_business_hours_timezone_and_paused_statuses() {
    let mut d = desk();
    let (a, g1) = (d.agent, d.g1);
    let sla = vec![DeskSlaIn {
        priority: "normal".into(),
        first_response_mins: 60,
        resolve_mins: 240,
    }];
    d.log.push(&d.owner, NOW - 3 * DAY, config(sla, true, true));
    // NOW is Thursday 12:30 UTC = 20:30 at +08:00: closed. The clock starts Friday 09:00 local
    // (01:00 UTC), so first response is due Friday 10:00 local = 02:00 UTC.
    d.log.push(&g1, NOW, create("t1", "after hours"));
    let v = view(&d, a).unwrap();
    let s = ticket(&v, "t1").sla.as_ref().unwrap();
    assert_eq!(s.first_due, NOW + 13 * HOUR + 30 * MIN);
    assert_eq!(s.resolve_due, Some(NOW + 16 * HOUR + 30 * MIN));
    assert!(!s.overdue && !s.paused);

    // Opened during the day, never answered: overdue. On hold pauses resolve clock.
    let created = NOW - 2 * DAY - 6 * HOUR; // Tuesday 06:30 UTC = 14:30 local
    d.log.push(&g1, created, create("t2", "in hours"));
    d.log
        .push(&a, created + 30 * MIN, set_status("t2", "on_hold"));
    let v = view(&d, a).unwrap();
    let s = ticket(&v, "t2").sla.as_ref().unwrap();
    assert!(s.paused);
    assert_eq!(s.first_due, created + HOUR);
    assert!(s.overdue, "no first response within an hour");
    assert_eq!(s.resolve_due, None, "paused with time left");
    // Resume: running again, due is pushed out by the paused time.
    d.log.push(&a, NOW - HOUR, set_status("t2", "open"));
    let v = view(&d, a).unwrap();
    let s = ticket(&v, "t2").sla.as_ref().unwrap();
    assert!(!s.paused && s.resolve_due.is_some());
    assert!(s.resolve_due.unwrap() > NOW - HOUR);
}

#[test]
fn merge_moves_comments_and_respects_visibility() {
    let mut d = desk();
    let (a, g1, g2) = (d.agent, d.g1, d.g2);
    d.log.push(&g1, NOW - 9 * HOUR, create("t1", "login fails"));
    d.log
        .push(&g2, NOW - 8 * HOUR, create("t2", "cannot sign in"));
    d.log.push(
        &g2,
        NOW - 7 * HOUR,
        comment("t2", "c2", "g2 says hi", false),
    );
    d.log.push(
        &a,
        NOW - 6 * HOUR,
        EventBody::TicketMerge {
            ticket_id: "t2".into(),
            into: "t1".into(),
        },
    );
    let av = view(&d, a).unwrap();
    assert_eq!(ticket(&av, "t2").merged_into.as_deref(), Some("t1"));
    assert_eq!(ticket(&av, "t2").status, "closed");
    assert_eq!(ticket(&av, "t1").merged_from, vec!["t2"]);
    assert_eq!(ticket(&av, "t1").comments.len(), 1);
    assert_eq!(
        av.stats.as_ref().unwrap().open,
        1,
        "merged ticket is not counted"
    );
    // g1 never sees g2's merged comment; g2 still sees only their own ticket.
    let g1v = view(&d, g1).unwrap();
    assert!(ticket(&g1v, "t1").comments.is_empty());
    assert_eq!(view(&d, g2).unwrap().tickets.len(), 1);
    // A merged ticket accepts no more comments; merging into a merged ticket is refused.
    d.log
        .push(&g2, NOW - 5 * HOUR, comment("t2", "c3", "late", false));
    d.log.push(&g1, NOW - 4 * HOUR, create("t3", "third"));
    d.log.push(
        &a,
        NOW - 3 * HOUR,
        EventBody::TicketMerge {
            ticket_id: "t3".into(),
            into: "t2".into(),
        },
    );
    d.log.push(
        &a,
        NOW - 2 * HOUR,
        EventBody::TicketMerge {
            ticket_id: "t1".into(),
            into: "t1".into(),
        },
    );
    let av = view(&d, a).unwrap();
    assert_eq!(ticket(&av, "t1").comments.len(), 1);
    assert_eq!(ticket(&av, "t3").merged_into, None);
    // Merging the target into another re-points earlier merges (no chains).
    d.log.push(
        &a,
        NOW - HOUR,
        EventBody::TicketMerge {
            ticket_id: "t1".into(),
            into: "t3".into(),
        },
    );
    let av = view(&d, a).unwrap();
    assert_eq!(ticket(&av, "t2").merged_into.as_deref(), Some("t3"));
    assert_eq!(ticket(&av, "t1").merged_into.as_deref(), Some("t3"));
}

fn csat(ticket: &str, score: u8) -> EventBody {
    EventBody::TicketCsat {
        ticket_id: ticket.into(),
        score,
        comment: Some("thanks".into()),
    }
}

#[test]
fn csat_only_by_requester_after_solved() {
    let mut d = desk();
    let (a, g1, g2) = (d.agent, d.g1, d.g2);
    d.log.push(&g1, NOW - 9 * HOUR, create("t1", "help"));
    d.log.push(&g1, NOW - 8 * HOUR, csat("t1", 5)); // not solved yet
    d.log.push(&a, NOW - 7 * HOUR, set_status("t1", "solved"));
    d.log.push(&g2, NOW - 6 * HOUR, csat("t1", 1)); // not the requester
    d.log.push(&a, NOW - 5 * HOUR, csat("t1", 1)); // agents cannot rate
    d.log.push(&g1, NOW - 4 * HOUR, csat("t1", 9)); // out of range
    assert!(ticket(&view(&d, a).unwrap(), "t1").csat.is_none());
    d.log.push(&g1, NOW - 3 * HOUR, csat("t1", 4));
    let av = view(&d, a).unwrap();
    let c = ticket(&av, "t1").csat.as_ref().unwrap();
    assert_eq!((c.score, c.comment.as_str()), (4, "thanks"));
    let st = av.stats.unwrap();
    assert_eq!((st.csat_avg, st.csat_count), (Some(4.0), 1));
    assert!(ticket(&view(&d, g1).unwrap(), "t1").csat.is_some());
}

#[test]
fn requester_reply_reopens_and_agent_reply_opens() {
    let mut d = desk();
    let (a, g1) = (d.agent, d.g1);
    d.log.push(&g1, NOW - 9 * HOUR, create("t1", "help"));
    d.log
        .push(&a, NOW - 8 * HOUR, comment("t1", "r1", "hi", false));
    assert_eq!(ticket(&view(&d, a).unwrap(), "t1").status, "open");
    d.log.push(&a, NOW - 7 * HOUR, set_status("t1", "solved"));
    d.log.push(
        &g1,
        NOW - 6 * HOUR,
        comment("t1", "r2", "still broken", false),
    );
    assert_eq!(ticket(&view(&d, a).unwrap(), "t1").status, "open");
    d.log.push(&a, NOW - 5 * HOUR, set_status("t1", "closed"));
    d.log
        .push(&g1, NOW - 4 * HOUR, comment("t1", "r3", "hello?", false));
    assert_eq!(
        ticket(&view(&d, a).unwrap(), "t1").comments.len(),
        2,
        "closed takes no replies"
    );
}

#[test]
fn macros_views_and_required_fields() {
    let mut d = desk();
    let (a, g1) = (d.agent, d.g1);
    d.log.push(
        &d.owner,
        NOW - 9 * HOUR,
        EventBody::DeskConfig {
            queues: vec![],
            fields: vec![DeskFieldIn {
                field_id: "os".into(),
                label: "OS".into(),
                kind: "select".into(),
                options: vec!["mac".into()],
                required: true,
            }],
            sla: vec![],
            business_hours: None,
            csat: true,
        },
    );
    d.log.push(&g1, NOW - 8 * HOUR, create("bad", "no os"));
    let mut good = create("good", "with os");
    if let EventBody::TicketCreate { fields, .. } = &mut good {
        fields.insert("os".into(), "mac".into());
        fields.insert("nope".into(), "x".into());
    }
    d.log.push(&g1, NOW - 7 * HOUR, good);
    d.log.push(
        &a,
        NOW - 6 * HOUR,
        EventBody::DeskMacro {
            macro_id: "m1".into(),
            name: "Solve".into(),
            actions: vec![MacroActionIn {
                set_status: Some("solved".into()),
                comment: Some("done".into()),
                ..Default::default()
            }],
            deleted: false,
        },
    );
    d.log.push(
        &a,
        NOW - 5 * HOUR,
        EventBody::DeskView {
            view_id: "v1".into(),
            name: "Mine".into(),
            filter: Default::default(),
            sort: "updated".into(),
            shared: false,
            deleted: false,
        },
    );
    let av = view(&d, a).unwrap();
    assert_eq!(av.tickets.len(), 1);
    assert_eq!(av.tickets[0].fields.len(), 1);
    assert_eq!(av.macros.len(), 1);
    assert_eq!(av.views.len(), 1);
    // A private view is invisible to the owner of the space as well.
    assert!(view(&d, d.owner).unwrap().views.is_empty());
}

#[test]
fn search_respects_guest_visibility() {
    let mut d = desk();
    let (a, g1, g2) = (d.agent, d.g1, d.g2);
    d.log.push(&g1, NOW - 9 * HOUR, create("t1", "printer jam"));
    d.log
        .push(&g2, NOW - 8 * HOUR, create("t2", "invoice mismatch"));
    d.log.push(
        &a,
        NOW - 7 * HOUR,
        comment("t1", "c", "toner swap needed", true),
    );
    d.log.push(
        &a,
        NOW - 6 * HOUR,
        comment("t1", "d", "visible reply", false),
    );
    let input = d.log.input(d.sid, "Acme", "Team", false);
    let rows = |me: UserId| -> Vec<(String, String)> {
        search_items(&me.to_string(), &input)
            .into_iter()
            .filter(|i| i.kind == "ticket")
            .map(|i| (i.id, i.text))
            .collect()
    };
    let agent = rows(a);
    assert_eq!(agent.len(), 2);
    assert!(agent.iter().any(|(_, t)| t.contains("toner")));
    let guest1 = rows(g1);
    assert_eq!(guest1.len(), 1);
    assert!(guest1[0].1.contains("printer jam") && guest1[0].1.contains("visible reply"));
    assert!(!guest1[0].1.contains("toner"));
    let guest2 = rows(g2);
    assert_eq!(guest2.len(), 1);
    assert!(guest2[0].1.contains("invoice"));
}

#[test]
fn desk_events_round_trip_through_cbor() {
    use hermod_core::event::decode_body;
    for body in [
        config(vec![], true, true),
        create("t", "s"),
        comment("t", "c", "b", true),
        csat("t", 3),
    ] {
        let mut plain = Vec::new();
        ciborium::into_writer(&body, &mut plain).unwrap();
        assert_eq!(decode_body(&plain).unwrap().body, body);
    }
}

mod core_path {
    use hermod_core::Core;
    use hermod_core::api::InviteOptions;
    use hermod_core::event::{EventBody, Role};
    use hermod_core::ids::SpaceId;
    use hermod_core::projections::shapes::Snapshot;

    fn sync(from: &Core, to: &Core, s: &SpaceId) {
        for ev in from.missing_since(s, &to.vector(s).unwrap()).unwrap() {
            to.ingest_sync(ev).unwrap();
        }
    }

    fn open() -> (tempfile::TempDir, Core) {
        let d = tempfile::tempdir().unwrap();
        let c = Core::open(d.path()).unwrap();
        (d, c)
    }

    #[test]
    fn guest_appends_tickets_through_the_real_append_path() {
        let (_d1, a) = open();
        let (_d2, g) = open();
        let s = a.space_create("Acme", "", "Team").unwrap().id;
        a.append(
            &s,
            EventBody::SectionRaise {
                section: "desk".into(),
            },
        )
        .unwrap();
        let inv = a
            .invite_create_with(
                &s,
                InviteOptions {
                    role: Role::Guest,
                    ..Default::default()
                },
            )
            .unwrap();
        g.invite_accept(&inv.code).unwrap();
        sync(&a, &g, &s);
        sync(&g, &a, &s);
        sync(&a, &g, &s);
        g.append(
            &s,
            EventBody::TicketCreate {
                ticket_id: "t1".into(),
                queue_id: String::new(),
                subject: "from a guest".into(),
                body: "help".into(),
                priority: "normal".into(),
                fields: Default::default(),
                attachments: vec![],
            },
        )
        .unwrap();
        sync(&g, &a, &s);
        let snap =
            |c: &Core| -> Snapshot { serde_json::from_value(c.snapshot().unwrap()).unwrap() };
        let av = snap(&a);
        let av = av.collections.desk.values().next().unwrap();
        assert_eq!(av.tickets.len(), 1);
        let gv = snap(&g);
        let gv = gv.collections.desk.values().next().unwrap();
        assert!(!gv.agent);
        assert_eq!(gv.tickets.len(), 1);
        // The Counting House grows with its tickets once raised.
        let sp = snap(&a)
            .spaces
            .into_iter()
            .find(|x| x.name == "Acme")
            .unwrap();
        assert_eq!(sp.growth.buildings.desk, 1);
    }
}

#[test]
fn macros_can_be_changed_only_by_author_or_admin() {
    let mut d = desk();
    let (a, owner) = (d.agent, d.owner);
    let (i, other) = user();
    d.log
        .push(&d.owner, NOW - 9 * HOUR, invite_as("m2", Role::Member));
    d.log.push(&other, NOW - 9 * HOUR, join_via("m2"));
    let mac = |by: &UserId, name: &str, deleted: bool, ts: i64, d: &mut Desk| {
        d.log.push(
            by,
            ts,
            EventBody::DeskMacro {
                macro_id: "m1".into(),
                name: name.into(),
                actions: vec![],
                deleted,
            },
        );
    };
    mac(&a, "Mine", false, NOW - 8 * HOUR, &mut d);
    mac(&other, "Hijack", false, NOW - 7 * HOUR, &mut d);
    mac(&other, "x", true, NOW - 6 * HOUR, &mut d);
    assert_eq!(view(&d, a).unwrap().macros[0].name, "Mine");
    mac(&owner, "Admin edit", false, NOW - 5 * HOUR, &mut d);
    assert_eq!(view(&d, a).unwrap().macros[0].name, "Admin edit");
    mac(&owner, "x", true, NOW - 4 * HOUR, &mut d);
    assert!(view(&d, a).unwrap().macros.is_empty());
    drop(i);
}

#[test]
fn named_time_zone_is_accepted() {
    let mut d = desk();
    let (a, g1) = (d.agent, d.g1);
    let sla = vec![DeskSlaIn {
        priority: "normal".into(),
        first_response_mins: 60,
        resolve_mins: 240,
    }];
    let mut cfg = config(sla, true, true);
    if let EventBody::DeskConfig { business_hours, .. } = &mut cfg {
        business_hours.as_mut().unwrap().tz = "Asia/Kuala_Lumpur".into();
    }
    d.log.push(&d.owner, NOW - 3 * DAY, cfg);
    d.log.push(&g1, NOW, create("t1", "after hours"));
    let v = view(&d, a).unwrap();
    // Same as the +08:00 case: Friday 10:00 local.
    assert_eq!(
        ticket(&v, "t1").sla.as_ref().unwrap().first_due,
        NOW + 13 * HOUR + 30 * MIN
    );
    assert_eq!(
        v.config.business_hours.as_ref().unwrap().tz,
        "Asia/Kuala_Lumpur"
    );
}
