//! Sealed-box wrapping of a space key to one member, used by `space.rekey`.
//!
//! The recipient's X25519 public key is derived from their ed25519 `UserId` (Montgomery form), so
//! wrapping needs nothing but the member list; the matching secret is derived from the identity.
//! The `x25519` field in `profile.set` is informational only: trusting it would let a member
//! redirect wraps. Wire form (hex): `eph_pub(32) || nonce(24) || AEAD(kek, space_key)`.

use ed25519_dalek::VerifyingKey;
use x25519_dalek::{PublicKey, StaticSecret};

use crate::crypto::{self, NONCE_LEN, SpaceKey, random_bytes};
use crate::error::{Error, Result};
use crate::identity::Identity;
use crate::ids::{UserId, hex_decode, hex_encode};

const KDF_CONTEXT: &str = "hermod/keywrap/v1";

/// The local user's X25519 secret, derived from the signing key.
fn secret_of(identity: &Identity) -> StaticSecret {
    StaticSecret::from(identity.scalar_bytes())
}

/// X25519 public key of a user, derived from their `UserId`.
pub fn public_of(user: &UserId) -> Result<[u8; 32]> {
    let vk = VerifyingKey::from_bytes(&user.0)
        .map_err(|_| Error::invalid("user id", "not a valid public key"))?;
    Ok(vk.to_montgomery().to_bytes())
}

/// The local user's X25519 public key (hex), as published in `profile.set`.
pub fn own_public_hex(identity: &Identity) -> String {
    hex_encode(PublicKey::from(&secret_of(identity)).as_bytes())
}

fn kek(shared: &[u8; 32], eph_pub: &[u8; 32], recipient: &[u8; 32]) -> SpaceKey {
    let mut ctx = shared.to_vec();
    ctx.extend_from_slice(eph_pub);
    ctx.extend_from_slice(recipient);
    SpaceKey(blake3::derive_key(KDF_CONTEXT, &ctx))
}

/// Seals `key` so only `recipient` can open it.
pub fn wrap(recipient: &UserId, key: &SpaceKey) -> Result<String> {
    let recipient_pub = public_of(recipient)?;
    let eph = StaticSecret::from(random_bytes::<32>());
    let eph_pub = PublicKey::from(&eph).to_bytes();
    let shared = eph.diffie_hellman(&PublicKey::from(recipient_pub));
    let kek = kek(shared.as_bytes(), &eph_pub, &recipient_pub);
    let (nonce, ct) = crypto::seal(&kek, &key.0)?;
    let mut out = eph_pub.to_vec();
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(hex_encode(&out))
}

/// Opens a wrap addressed to `identity`. Any other recipient gets [`Error::Decrypt`].
pub fn unwrap(identity: &Identity, sealed_hex: &str) -> Result<SpaceKey> {
    let raw = hex_decode(sealed_hex)?;
    if raw.len() <= 32 + NONCE_LEN {
        return Err(Error::invalid("key wrap", "too short"));
    }
    let eph_pub: [u8; 32] = raw[..32].try_into().expect("32 bytes");
    let nonce: [u8; NONCE_LEN] = raw[32..32 + NONCE_LEN].try_into().expect("24 bytes");
    let secret = secret_of(identity);
    let my_pub = PublicKey::from(&secret).to_bytes();
    let shared = secret.diffie_hellman(&PublicKey::from(eph_pub));
    let kek = kek(shared.as_bytes(), &eph_pub, &my_pub);
    let key = crypto::open(&kek, &nonce, &raw[32 + NONCE_LEN..])?;
    Ok(SpaceKey(key.try_into().map_err(|_| {
        Error::invalid("key wrap", "bad key length")
    })?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_recipient_can_open() {
        let (alice, bob) = (Identity::generate(), Identity::generate());
        let key = SpaceKey::random();
        let sealed = wrap(&alice.user_id(), &key).unwrap();
        assert_eq!(unwrap(&alice, &sealed).unwrap(), key);
        assert!(matches!(unwrap(&bob, &sealed), Err(Error::Decrypt)));
        assert!(unwrap(&alice, "00").is_err());
        let mut tampered = sealed.clone().into_bytes();
        tampered[70] = if tampered[70] == b'0' { b'1' } else { b'0' };
        assert!(unwrap(&alice, std::str::from_utf8(&tampered).unwrap()).is_err());
    }

    #[test]
    fn published_public_key_matches_derived_one() {
        let id = Identity::generate();
        assert_eq!(
            own_public_hex(&id),
            hex_encode(&public_of(&id.user_id()).unwrap())
        );
    }

    #[test]
    fn wraps_are_fresh() {
        let id = Identity::generate();
        let key = SpaceKey::random();
        assert_ne!(
            wrap(&id.user_id(), &key).unwrap(),
            wrap(&id.user_id(), &key).unwrap()
        );
    }
}
