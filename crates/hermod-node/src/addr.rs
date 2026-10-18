//! Multiaddr classification helpers.

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

pub fn classify(a: &Multiaddr) -> Class {
    if a.iter().any(|p| matches!(p, Protocol::P2pCircuit)) {
        return Class::Relay;
    }
    match a.iter().next() {
        Some(Protocol::Ip4(ip)) if ip.is_unspecified() => Class::Unspecified,
        Some(Protocol::Ip4(ip)) if ip.is_loopback() => Class::Loopback,
        Some(Protocol::Ip4(ip)) if ip.is_private() || ip.is_link_local() => Class::Private,
        Some(Protocol::Ip6(ip)) if ip.is_unspecified() => Class::Unspecified,
        Some(Protocol::Ip6(ip)) if ip.is_loopback() => Class::Loopback,
        Some(Protocol::Ip6(ip))
            if (ip.segments()[0] & 0xfe00) == 0xfc00 || (ip.segments()[0] & 0xffc0) == 0xfe80 =>
        {
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
