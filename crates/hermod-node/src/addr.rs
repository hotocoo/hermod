//! Multiaddr classification helpers.

use std::net::{Ipv4Addr, Ipv6Addr};

use libp2p::multiaddr::Protocol;
use libp2p::{Multiaddr, PeerId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Class {
    Public,
    Relay,
    Private,
    Loopback,
    Unspecified,
}

fn classify_v4(ip: Ipv4Addr) -> Class {
    let o = ip.octets();
    // 100.64.0.0/10 is carrier-grade NAT: not routable from outside.
    let cgnat = o[0] == 100 && (o[1] & 0xc0) == 0x40;
    if ip.is_unspecified() {
        Class::Unspecified
    } else if ip.is_loopback() {
        Class::Loopback
    } else if ip.is_private() || ip.is_link_local() || cgnat || ip.is_broadcast() {
        Class::Private
    } else {
        Class::Public
    }
}

fn classify_v6(ip: Ipv6Addr) -> Class {
    // `::ffff:a.b.c.d` is the IPv4 address in disguise: judge it as IPv4.
    if let Some(v4) = ip.to_ipv4_mapped() {
        return classify_v4(v4);
    }
    let first = ip.segments()[0];
    if ip.is_unspecified() {
        Class::Unspecified
    } else if ip.is_loopback() {
        Class::Loopback
    } else if (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80 {
        Class::Private
    } else {
        Class::Public
    }
}

pub fn classify(a: &Multiaddr) -> Class {
    if a.iter().any(|p| matches!(p, Protocol::P2pCircuit)) {
        return Class::Relay;
    }
    match a.iter().next() {
        Some(Protocol::Ip4(ip)) => classify_v4(ip),
        Some(Protocol::Ip6(ip)) => classify_v6(ip),
        // A name can resolve to anything (even a private address) and is chosen by the peer:
        // never handed on to others unless private addresses are allowed.
        Some(Protocol::Dns(_) | Protocol::Dns4(_) | Protocol::Dns6(_) | Protocol::Dnsaddr(_)) => {
            Class::Private
        }
        _ => Class::Public,
    }
}

/// Should this address be handed to others (invites, peer book)?
pub fn shareable(a: &Multiaddr, allow_private: bool) -> bool {
    match classify(a) {
        Class::Public | Class::Relay => true,
        Class::Private | Class::Loopback => allow_private,
        Class::Unspecified => false,
    }
}

/// Peer id carried by the final `/p2p/` component, if any.
pub fn peer_of(a: &Multiaddr) -> Option<PeerId> {
    match a.iter().last() {
        Some(Protocol::P2p(p)) => Some(p),
        _ => None,
    }
}

pub fn with_peer(mut a: Multiaddr, peer: PeerId) -> Multiaddr {
    if peer_of(&a) != Some(peer) {
        a.push(Protocol::P2p(peer));
    }
    a
}

/// Address without the trailing `/p2p/<id>`.
pub fn without_peer(mut a: Multiaddr) -> Multiaddr {
    if matches!(a.iter().last(), Some(Protocol::P2p(_))) {
        a.pop();
    }
    a
}

#[cfg(test)]
mod tests {
    use super::*;

    fn class(s: &str) -> Class {
        classify(&s.parse().unwrap())
    }

    #[test]
    fn names_mapped_cgnat_and_local_ranges_are_not_public() {
        assert_eq!(class("/dns4/evil.example/tcp/1"), Class::Private);
        assert_eq!(class("/dns/evil.example/tcp/1"), Class::Private);
        assert_eq!(class("/dnsaddr/evil.example"), Class::Private);
        assert_eq!(class("/ip6/::ffff:10.0.0.1/tcp/1"), Class::Private);
        assert_eq!(class("/ip6/::ffff:127.0.0.1/tcp/1"), Class::Loopback);
        assert_eq!(class("/ip4/100.64.0.1/tcp/1"), Class::Private);
        assert_eq!(class("/ip4/100.127.255.254/tcp/1"), Class::Private);
        assert_eq!(class("/ip4/100.128.0.1/tcp/1"), Class::Public);
        assert_eq!(class("/ip4/169.254.1.1/tcp/1"), Class::Private);
        assert_eq!(class("/ip6/fe80::1/tcp/1"), Class::Private);
        assert_eq!(class("/ip6/fd00::1/tcp/1"), Class::Private);
        assert_eq!(class("/ip4/8.8.8.8/tcp/1"), Class::Public);
        assert!(!shareable(
            &"/dns4/evil.example/tcp/1".parse().unwrap(),
            false
        ));
        assert!(shareable(&"/dns4/lan.local/tcp/1".parse().unwrap(), true));
    }
}
