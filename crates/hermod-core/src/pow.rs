//! Optional proof-of-work on join requests (E-011): `blake3(invite_id || joiner_id || nonce)`
//! must have a space-chosen number of leading zero bits.

use crate::crypto::blake3_hash;
use crate::error::{Error, Result};

/// Highest `join_pow_bits` a space may ask for (about 2^24 hashes, seconds on a laptop).
pub const MAX_JOIN_POW_BITS: u8 = 24;

fn digest(invite_id: &str, joiner: &str, nonce: u64) -> [u8; 32] {
    let mut buf = Vec::with_capacity(invite_id.len() + joiner.len() + 8);
    buf.extend_from_slice(invite_id.as_bytes());
    buf.extend_from_slice(joiner.as_bytes());
    buf.extend_from_slice(&nonce.to_le_bytes());
    blake3_hash(&buf)
}

fn leading_zero_bits(h: &[u8; 32]) -> u32 {
    let mut n = 0;
    for b in h {
        n += b.leading_zeros();
        if *b != 0 {
            break;
        }
    }
    n
}

/// True when `nonce` meets `bits`; `bits == 0` needs no work.
pub fn verify(invite_id: &str, joiner: &str, nonce: Option<u64>, bits: u8) -> bool {
    bits == 0
        || nonce
            .is_some_and(|n| leading_zero_bits(&digest(invite_id, joiner, n)) >= u32::from(bits))
}

/// Finds a nonce meeting `bits`. `None` when `bits == 0` (nothing to send).
pub fn mine(invite_id: &str, joiner: &str, bits: u8) -> Result<Option<u64>> {
    if bits > MAX_JOIN_POW_BITS {
        return Err(Error::invalid(
            "join_pow_bits",
            "above the supported maximum",
        ));
    }
    if bits == 0 {
        return Ok(None);
    }
    Ok((0..=u64::MAX).find(|n| verify(invite_id, joiner, Some(*n), bits)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mined_nonce_verifies_and_missing_or_weak_fails() {
        let n = mine("inv", "alice", 12).unwrap().unwrap();
        assert!(verify("inv", "alice", Some(n), 12));
        assert!(!verify("inv", "alice", None, 12));
        assert!(!verify("inv", "bob", Some(n), 12) || !verify("inv", "bob", Some(n), 24));
        let weak = (0..)
            .find(|n| !verify("inv", "alice", Some(*n), 12))
            .unwrap();
        assert!(!verify("inv", "alice", Some(weak), 12));
    }

    #[test]
    fn zero_bits_is_no_work() {
        assert_eq!(mine("inv", "alice", 0).unwrap(), None);
        assert!(verify("inv", "alice", None, 0));
    }

    #[test]
    fn bits_above_the_cap_are_refused() {
        assert!(mine("inv", "alice", MAX_JOIN_POW_BITS + 1).is_err());
    }
}
