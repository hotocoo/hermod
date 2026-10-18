//! InviteV1: CBOR then base58, plus link builders and parsers.

use serde::{Deserialize, Serialize};

use crate::crypto::SpaceKey;
use crate::error::{Error, Result};
use crate::ids::{SpaceId, UserId};

/// Landing page that forwards to the app. The code lives in the fragment and never reaches a server.
pub const LINK_BASE: &str = "https://hotocoo.github.io/hermod/join#";
/// Custom scheme opened by the landing page.
pub const DEEP_LINK_BASE: &str = "hermod://join/";

const MAX_CODE_CHARS: usize = 2048;
const MAX_ADDRS: usize = 16;
const MAX_NAME_CHARS: usize = 128;
const MAX_ID_CHARS: usize = 64;
const MAX_ADDR_CHARS: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InviteV1 {
    pub v: u8,
    /// Id of the matching `invite.create` event; joins reference it.
    pub id: String,
    pub space_id: SpaceId,
    /// Space key at `epoch`.
    pub space_key: SpaceKey,
    pub epoch: u32,
    /// Lamport clock of the `invite.create` event: the joiner's events must order after it.
    pub lc: u64,
    pub name: String,
    pub inviter: UserId,
    /// Multiaddrs where the inviter (or a relay) can be reached.
    pub addrs: Vec<String>,
    /// Expiry as unix seconds, or `None` for never.
    pub exp: Option<u64>,
}

impl InviteV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: impl Into<String>,
        space_id: SpaceId,
        space_key: SpaceKey,
        epoch: u32,
        lc: u64,
        name: impl Into<String>,
        inviter: UserId,
        addrs: Vec<String>,
        exp: Option<u64>,
    ) -> Self {
        InviteV1 {
            v: 1,
            id: id.into(),
            space_id,
            space_key,
            epoch,
            lc,
            name: name.into(),
            inviter,
            addrs,
            exp,
        }
    }

    /// Serialized form: CBOR, base58.
    pub fn encode(&self) -> Result<String> {
        let mut buf = Vec::new();
        ciborium::into_writer(self, &mut buf).map_err(|e| Error::Cbor(e.to_string()))?;
        Ok(bs58::encode(buf).into_string())
    }

    /// Parses a bare code and validates version and bounds. Expiry is checked separately.
    pub fn decode(code: &str) -> Result<Self> {
        let code = code.trim();
        if code.is_empty() || code.len() > MAX_CODE_CHARS {
            return Err(Error::invalid("invite", "bad length"));
        }
        let raw = bs58::decode(code)
            .into_vec()
            .map_err(|e| Error::invalid("invite", e.to_string()))?;
        let inv: InviteV1 = ciborium::from_reader(raw.as_slice())
            .map_err(|e| Error::invalid("invite", e.to_string()))?;
        if inv.v != 1 {
            return Err(Error::invalid(
                "invite",
                format!("unsupported version {}", inv.v),
            ));
        }
        if inv.name.chars().count() > MAX_NAME_CHARS
            || inv.id.chars().count() > MAX_ID_CHARS
            || inv.addrs.len() > MAX_ADDRS
            || inv.addrs.iter().any(|a| a.len() > MAX_ADDR_CHARS)
        {
            return Err(Error::invalid("invite", "field out of bounds"));
        }
        Ok(inv)
    }

    /// Accepts a bare code, the https landing link, or the `hermod://` deep link.
    pub fn parse(input: &str) -> Result<Self> {
        let s = input.trim();
        let code = if let Some(rest) = s.strip_prefix(DEEP_LINK_BASE) {
            rest.trim_end_matches('/')
        } else if let Some(rest) = s.strip_prefix(LINK_BASE) {
            rest
        } else if let Some((_, frag)) = s.split_once('#') {
            frag
        } else {
            s
        };
        Self::decode(code)
    }

    pub fn is_expired(&self, now_secs: u64) -> bool {
        self.exp.is_some_and(|e| now_secs >= e)
    }

    pub fn check_expiry(&self, now_secs: u64) -> Result<()> {
        if self.is_expired(now_secs) {
            Err(Error::InviteExpired)
        } else {
            Ok(())
        }
    }

    pub fn link(&self) -> Result<String> {
        Ok(format!("{LINK_BASE}{}", self.encode()?))
    }

    pub fn deep_link(&self) -> Result<String> {
        Ok(format!("{DEEP_LINK_BASE}{}", self.encode()?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::Identity;

    fn sample(exp: Option<u64>) -> InviteV1 {
        InviteV1::new(
            "inv1",
            SpaceId::random(),
            SpaceKey::random(),
            0,
            7,
            "Kiln Club",
            Identity::generate().user_id(),
            vec!["/ip4/203.0.113.7/tcp/4001".into()],
            exp,
        )
    }

    #[test]
    fn codec_round_trip_and_links() {
        let inv = sample(None);
        let code = inv.encode().unwrap();
        assert_eq!(InviteV1::decode(&code).unwrap(), inv);
        let link = inv.link().unwrap();
        assert!(link.starts_with("https://hotocoo.github.io/hermod/join#"));
        let deep = inv.deep_link().unwrap();
        assert!(deep.starts_with("hermod://join/"));
        for form in [
            code.as_str(),
            link.as_str(),
            deep.as_str(),
            &format!("{deep}/"),
        ] {
            assert_eq!(InviteV1::parse(form).unwrap(), inv);
        }
    }

    #[test]
    fn expiry() {
        let inv = sample(Some(1000));
        assert!(inv.check_expiry(999).is_ok());
        assert!(matches!(inv.check_expiry(1000), Err(Error::InviteExpired)));
        assert!(sample(None).check_expiry(u64::MAX).is_ok());
    }

    #[test]
    fn rejects_garbage_and_bad_versions() {
        assert!(InviteV1::decode("").is_err());
        assert!(InviteV1::decode("0OIl").is_err());
        assert!(InviteV1::decode(&"1".repeat(5000)).is_err());
        assert!(InviteV1::decode(&bs58::encode(b"not cbor at all").into_string()).is_err());
        let mut inv = sample(None);
        inv.v = 2;
        assert!(InviteV1::decode(&inv.encode().unwrap()).is_err());
        let mut many = sample(None);
        many.addrs = vec!["a".into(); 40];
        assert!(InviteV1::decode(&many.encode().unwrap()).is_err());
    }
}
