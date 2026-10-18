//! Island growth (contract section 5): computed from the log on every projection, never stored.
//! Every threshold lives in [`GrowthConfig`].

use serde::{Deserialize, Serialize};

/// Number of island tiers.
pub const TIERS: usize = 5;

/// Content counts needed for building levels 2 and 3 (level 1 is "raised").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LevelThresholds {
    pub level2: u32,
    pub level3: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GrowthConfig {
    /// Minimum member count of each tier (tier 1 first).
    pub tier_min_members: [u32; TIERS],
    /// Island radius in world units per tier.
    pub tier_radius: [f64; TIERS],
    pub chat: LevelThresholds,
    pub hearth: LevelThresholds,
    pub feed: LevelThresholds,
    pub board: LevelThresholds,
    pub skein: LevelThresholds,
    pub arcade: LevelThresholds,
    pub desk: LevelThresholds,
    /// Window for the `active7d` figure.
    pub active_window_ms: i64,
}

impl Default for GrowthConfig {
    fn default() -> Self {
        GrowthConfig {
            tier_min_members: [1, 3, 8, 25, 100],
            tier_radius: [10.0, 14.0, 19.0, 26.0, 36.0],
            chat: LevelThresholds {
                level2: 50,
                level3: 500,
            },
            hearth: LevelThresholds {
                level2: 3,
                level3: 20,
            },
            feed: LevelThresholds {
                level2: 10,
                level3: 100,
            },
            board: LevelThresholds {
                level2: 10,
                level3: 60,
            },
            desk: LevelThresholds {
                level2: 10,
                level3: 60,
            },
            arcade: LevelThresholds {
                level2: 8,
                level3: 60,
            },
            skein: LevelThresholds {
                level2: 10,
                level3: 60,
            },
            active_window_ms: 7 * 24 * 60 * 60 * 1000,
        }
    }
}

/// Content counted toward each building.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Counts {
    pub chat: u32,
    pub hearth: u32,
    pub feed: u32,
    pub board: u32,
    pub skein: u32,
    pub arcade: u32,
    pub desk: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct House {
    pub user_id: String,
    pub plot_index: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Buildings {
    pub chat: u8,
    pub hearth: u8,
    pub feed: u8,
    pub board: u8,
    pub skein: u8,
    pub arcade: u8,
    pub desk: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Growth {
    pub members: u32,
    pub active7d: u32,
    pub tier: u8,
    pub radius: f64,
    pub houses: Vec<House>,
    pub buildings: Buildings,
    /// Games waiting for a player (lights the Games Hall sign on the island).
    #[serde(default)]
    pub waiting_games: u32,
}

pub struct GrowthInput<'a> {
    /// Current members with their stable plot index, in plot order.
    pub members: &'a [(String, u32)],
    pub active: u32,
    /// Sections currently raised in the space.
    pub sections: &'a [String],
    pub counts: Counts,
}

pub fn tier_for(cfg: &GrowthConfig, members: u32) -> u8 {
    let tier = cfg
        .tier_min_members
        .iter()
        .take_while(|&&min| members >= min)
        .count();
    tier.clamp(1, TIERS) as u8
}

fn level(raised: bool, count: u32, th: LevelThresholds) -> u8 {
    match (raised, count) {
        (false, _) => 0,
        (true, c) if c >= th.level3 => 3,
        (true, c) if c >= th.level2 => 2,
        _ => 1,
    }
}

pub fn compute(cfg: &GrowthConfig, input: &GrowthInput) -> Growth {
    let members = input.members.len() as u32;
    let tier = tier_for(cfg, members);
    let raised = |s: &str| input.sections.iter().any(|x| x == s);
    let c = input.counts;
    Growth {
        members,
        active7d: input.active,
        tier,
        radius: cfg.tier_radius[tier as usize - 1],
        houses: input
            .members
            .iter()
            .map(|(u, p)| House {
                user_id: u.clone(),
                plot_index: *p,
            })
            .collect(),
        buildings: Buildings {
            chat: level(raised("chat"), c.chat, cfg.chat),
            hearth: level(raised("hearth"), c.hearth, cfg.hearth),
            feed: level(raised("feed"), c.feed, cfg.feed),
            board: level(raised("board"), c.board, cfg.board),
            skein: level(raised("skein"), c.skein, cfg.skein),
            arcade: level(raised("arcade"), c.arcade, cfg.arcade),
            desk: level(raised("desk"), c.desk, cfg.desk),
        },
        waiting_games: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiers_follow_member_thresholds() {
        let cfg = GrowthConfig::default();
        let expect = [
            (0, 1),
            (1, 1),
            (2, 1),
            (3, 2),
            (7, 2),
            (8, 3),
            (24, 3),
            (25, 4),
            (99, 4),
            (100, 5),
            (5000, 5),
        ];
        for (m, t) in expect {
            assert_eq!(tier_for(&cfg, m), t, "{m} members");
        }
    }

    #[test]
    fn radius_grows_with_tier_and_levels_follow_counts() {
        let cfg = GrowthConfig::default();
        let members: Vec<_> = (0..8).map(|i| (format!("user{i}"), i as u32)).collect();
        let sections = vec!["chat".to_string(), "feed".to_string()];
        let g = compute(
            &cfg,
            &GrowthInput {
                members: &members,
                active: 4,
                sections: &sections,
                counts: Counts {
                    chat: 60,
                    hearth: 99,
                    feed: 0,
                    board: 0,
                    skein: 0,
                    arcade: 0,
                    desk: 0,
                },
            },
        );
        assert_eq!((g.members, g.active7d, g.tier, g.radius), (8, 4, 3, 19.0));
        assert_eq!(
            g.buildings,
            Buildings {
                chat: 2,
                hearth: 0,
                feed: 1,
                board: 0,
                skein: 0,
                arcade: 0,
                desk: 0
            }
        );
        assert_eq!(g.houses.len(), 8);
        let big = compute(
            &cfg,
            &GrowthInput {
                members: &members,
                active: 0,
                sections: &sections,
                counts: Counts {
                    chat: 500,
                    feed: 100,
                    ..Counts::default()
                },
            },
        );
        assert_eq!((big.buildings.chat, big.buildings.feed), (3, 3));
        let radii: Vec<f64> = (1..=TIERS as u32)
            .map(|t| {
                cfg.tier_radius[tier_for(&cfg, cfg.tier_min_members[t as usize - 1]) as usize - 1]
            })
            .collect();
        assert!(radii.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn config_overrides_apply() {
        let cfg = GrowthConfig {
            tier_min_members: [1, 2, 3, 4, 5],
            ..GrowthConfig::default()
        };
        assert_eq!(tier_for(&cfg, 4), 4);
    }
}
