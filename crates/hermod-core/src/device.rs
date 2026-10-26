//! Device certificates: an identity vouches for a device key by signing it.
//!
//! A linked device has its own ed25519 key and signs its own events (`author` is the device key).
//! The fold attributes them to the identity that certified the device, and stops doing so once the
//! identity revokes it. The link also carries the device's proof of possession, so an identity
//! cannot claim somebody else's key as its device.

use serde::{Deserialize, Serialize};

use crate::crypto::SpaceKey;
use crate::error::{Error, Result};
use crate::identity::{self, Identity};
use crate::ids::{self, SpaceId, UserId, hex_decode_array, hex_encode};
use crate::store::{MAX_CLOCK, MAX_EPOCH};

/// How long a link code stays usable after it is shown.
pub const LINK_TTL_SECS: u64 = 600;
const MAX_CODE_CHARS: usize = 32 * 1024;
const MAX_SPACES: usize = 512;
const MAX_KEYS_PER_SPACE: usize = 64;
const MAX_NAME_CHARS: usize = 128;
const MAX_ADDRS: usize = 16;
const MAX_ADDR_CHARS: usize = 256;
const MAX_PROFILE_CHARS: usize = 8 * 1024;

const DOMAIN: &[u8] = b"hermod/device/v1";

fn preimage(device_pub: &[u8; 32]) -> Vec<u8> {
    let mut m = DOMAIN.to_vec();
    m.extend_from_slice(device_pub);
    m
}

const PROOF_DOMAIN: &[u8] = b"hermod/device-proof/v1";

fn proof_preimage(user: &UserId, device_pub: &[u8; 32]) -> Vec<u8> {
    let mut m = PROOF_DOMAIN.to_vec();
    m.extend_from_slice(&user.0);
    m.extend_from_slice(device_pub);
    m
}

/// Hex certificate: the identity's signature over the device public key.
pub fn make_cert(identity: &Identity, device_pub: &[u8; 32]) -> String {
    hex_encode(&identity.sign(&preimage(device_pub)))
}

/// True when `cert_hex` is `user`'s signature over `device_pub_hex`.
pub fn verify_cert(user: &UserId, device_pub_hex: &str, cert_hex: &str) -> bool {
    let (Ok(device), Ok(sig)) = (
        hex_decode_array::<32>(device_pub_hex),
        hex_decode_array::<64>(cert_hex),
    ) else {
        return false;
    };
    identity::verify(user, &preimage(&device), &sig).is_ok()
}

/// Hex proof of possession: the device's signature over the identity it joins.
pub fn make_proof(device: &Identity, user: &UserId) -> String {
    hex_encode(&device.sign(&proof_preimage(user, &device.user_id().0)))
}

/// True when `proof_hex` is the device key's signature over `user`.
pub fn verify_proof(user: &UserId, device_pub_hex: &str, proof_hex: &str) -> bool {
    let (Ok(device), Ok(sig)) = (
        hex_decode_array::<32>(device_pub_hex),
        hex_decode_array::<64>(proof_hex),
    ) else {
        return false;
    };
    identity::verify(&UserId(device), &proof_preimage(user, &device), &sig).is_ok()
}

/// One space handed to a new device: every key epoch held, so history opens once it syncs.
#[derive(Clone, Serialize, Deserialize)]
pub struct LinkSpace {
    pub id: SpaceId,
    pub name: String,
    pub kind: String,
    pub is_home: bool,
    /// `(epoch, key)` pairs; never empty.
    pub keys: Vec<(u32, SpaceKey)>,
    /// Lamport of the `device.link` event in this space: the device's events must order after it.
    pub lc: u64,
}

/// What the QR or code carries: a fresh device key, its certificate and the space keys.
/// It is a bearer secret: whoever holds it before it expires is the device.
// shortcut: the code is not bound to one scanner (no handshake round trip), so a copy used twice
// yields two installs sharing one key; upgrade by adding a confirm event before keys are released.
// Revoking the device ends both.
#[derive(Clone, Serialize, Deserialize)]
pub struct DeviceLinkV1 {
    pub v: u8,
    pub owner: UserId,
    #[serde(with = "ids::fixed")]
    pub device_seed: [u8; 32],
    pub cert: String,
    pub proof: String,
    /// Expiry as unix seconds.
    pub exp: u64,
    pub spaces: Vec<LinkSpace>,
    /// Where the linking device can be reached.
    pub addrs: Vec<String>,
    /// The identity's stored profile (JSON) so the new device shows the same name and avatar.
    pub profile: Option<String>,
}

// The seed and keys must never reach a log, so Debug names the shape only.
impl std::fmt::Debug for DeviceLinkV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "DeviceLinkV1({})", self.owner.short())
    }
}

impl DeviceLinkV1 {
    /// Serialized form: CBOR, base58.
    pub fn encode(&self) -> Result<String> {
        let mut buf = Vec::new();
        ciborium::into_writer(self, &mut buf).map_err(|e| Error::Cbor(e.to_string()))?;
        Ok(bs58::encode(buf).into_string())
    }

    /// Parses a code and validates version, bounds and both signatures. Expiry is checked by
    /// [`DeviceLinkV1::check_expiry`].
    pub fn decode(code: &str) -> Result<Self> {
        let bad = |why: &str| Error::invalid("device link", why.to_string());
        let code = code.trim();
        if code.is_empty() || code.len() > MAX_CODE_CHARS {
            return Err(bad("bad length"));
        }
        let raw = bs58::decode(code)
            .into_vec()
            .map_err(|_| bad("not a link code"))?;
        let l: DeviceLinkV1 =
            ciborium::from_reader(raw.as_slice()).map_err(|_| bad("not a link code"))?;
        if l.v != 1 {
            return Err(bad("unsupported version"));
        }
        let in_bounds = l.spaces.len() <= MAX_SPACES
            && l.addrs.len() <= MAX_ADDRS
            && l.addrs.iter().all(|a| a.len() <= MAX_ADDR_CHARS)
            && l.profile
                .as_ref()
                .is_none_or(|p| p.len() <= MAX_PROFILE_CHARS)
            && l.spaces.iter().all(|s| {
                !s.keys.is_empty()
                    && s.keys.len() <= MAX_KEYS_PER_SPACE
                    && s.name.chars().count() <= MAX_NAME_CHARS
                    && s.kind.chars().count() <= MAX_NAME_CHARS
                    && s.lc <= MAX_CLOCK
                    && s.keys.iter().all(|(e, _)| *e <= MAX_EPOCH)
            });
        if !in_bounds {
            return Err(bad("field out of bounds"));
        }
        let device = Identity::from_seed(l.device_seed).user_id();
        let device_hex = hex_encode(&device.0);
        if !verify_cert(&l.owner, &device_hex, &l.cert)
            || !verify_proof(&l.owner, &device_hex, &l.proof)
        {
            return Err(bad("the code is not signed by its identity"));
        }
        Ok(l)
    }

    pub fn check_expiry(&self, now_secs: u64) -> Result<()> {
        if now_secs >= self.exp {
            return Err(Error::invalid(
                "device link",
                "this code has expired; show a new one on the other device",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cert_binds_identity_and_device() {
        let id = Identity::generate();
        let device = [7u8; 32];
        let cert = make_cert(&id, &device);
        assert!(verify_cert(&id.user_id(), &hex_encode(&device), &cert));
        assert!(!verify_cert(&id.user_id(), &hex_encode(&[8u8; 32]), &cert));
        assert!(!verify_cert(
            &Identity::generate().user_id(),
            &hex_encode(&device),
            &cert
        ));
        assert!(!verify_cert(&id.user_id(), "zz", &cert));
    }

    #[test]
    fn proof_binds_device_to_identity() {
        let (id, dev) = (Identity::generate(), Identity::generate());
        let dev_hex = hex_encode(&dev.user_id().0);
        let proof = make_proof(&dev, &id.user_id());
        assert!(verify_proof(&id.user_id(), &dev_hex, &proof));
        assert!(!verify_proof(
            &Identity::generate().user_id(),
            &dev_hex,
            &proof
        ));
        assert!(!verify_proof(
            &id.user_id(),
            &hex_encode(&[1u8; 32]),
            &proof
        ));
        assert!(!verify_proof(&id.user_id(), &dev_hex, "zz"));
    }

    fn sample(owner: &Identity, dev: &Identity, exp: u64) -> DeviceLinkV1 {
        DeviceLinkV1 {
            v: 1,
            owner: owner.user_id(),
            device_seed: dev.seed(),
            cert: make_cert(owner, &dev.user_id().0),
            proof: make_proof(dev, &owner.user_id()),
            exp,
            spaces: vec![LinkSpace {
                id: SpaceId([3u8; 32]),
                name: "S".into(),
                kind: "Space".into(),
                is_home: false,
                keys: vec![(0, SpaceKey::random())],
                lc: 1,
            }],
            addrs: vec![],
            profile: None,
        }
    }

    #[test]
    fn link_code_round_trips_and_rejects_forgeries() {
        let (owner, dev) = (Identity::generate(), Identity::generate());
        let code = sample(&owner, &dev, 100).encode().unwrap();
        let l = DeviceLinkV1::decode(&code).unwrap();
        assert!(l.check_expiry(99).is_ok());
        assert!(l.check_expiry(100).is_err());
        assert!(format!("{l:?}").len() < 40, "debug must not print secrets");
        // Someone else's key under this identity: certificate and proof do not match.
        let mut forged = sample(&owner, &dev, 100);
        forged.device_seed = Identity::generate().seed();
        assert!(DeviceLinkV1::decode(&forged.encode().unwrap()).is_err());
        assert!(DeviceLinkV1::decode("not base58 !").is_err());
        assert!(DeviceLinkV1::decode("").is_err());
    }
}
