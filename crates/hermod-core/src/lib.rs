//! hermod-core: everything below the network.
//!
//! Identity and crypto, the signed event log, the SQLite store, content-addressed blobs,
//! deterministic projections that produce exactly the JSON the UI consumes, island growth, and
//! the [`Core`] facade tying them together. See `docs/ARCHITECTURE.md` for the contract.

pub mod api;
pub mod backup;
pub mod blobs;
pub mod crypto;
pub mod device;
pub mod error;
pub mod event;
pub mod games;
pub mod growth;
pub mod identity;
pub mod ids;
pub mod invite;
pub mod keywrap;
pub mod messaging;
pub mod migrations;
pub mod msgext;
pub mod projections;
pub mod ratelimit;
pub mod search;
pub mod snapdir;
pub mod store;
pub mod textdiff;

pub use api::{
    Core, CoreConfig, IdentityInfo, InviteOut, Joined, LegalStatus, ProfileInput, SpaceCreated,
    SpaceSummary,
};
pub use error::{Error, Result};
pub use event::{BlobRef, EventBody, Role, SignedEvent};
pub use ids::{SpaceId, UserId};
