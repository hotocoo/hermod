//! Device certificates: an identity vouches for a device key by signing it.
//!
//! Only the certificate and its fold are implemented. Letting a linked device sign events on
//! behalf of the identity changes who may author an event, and is tracked as D-001 (M2).

use crate::identity::{self, Identity};
use crate::ids::{UserId, hex_decode_array, hex_encode};

const DOMAIN: &[u8] = b"hermod/device/v1";

fn preimage(device_pub: &[u8; 32]) -> Vec<u8> {
    let mut m = DOMAIN.to_vec();
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
}
