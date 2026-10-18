---
title: Privacy Notice
version: "2026-10-15"
---

# Hermod Privacy Notice

Version 2026-10-15

This text is not legal advice; have it reviewed before relying on it.

## 1. Summary

- No accounts, no central server, no telemetry, no analytics.
- Your data lives on your device and on the devices of the members of your spaces, encrypted.
- Other peers can see your IP address and PeerId when your computer connects to them.
- We, the Hermod contributors, do not collect or receive your data.

## 2. Who is responsible

The Hermod contributors publish the software. Because we never receive your data, we do not hold it. You and the other members of your spaces hold it.

## 3. What is stored on your device

- Your identity key and PeerId, generated on first run, stored in the app data folder.
- Your profile (name, bio, initials, optional avatar).
- The events and files of every space you are in, stored encrypted with the space key.
- A cache of encrypted data for other spaces (up to your configured cap), which you cannot read.
- Your settings and the Terms version you accepted, with a timestamp.

## 4. What other peers can see

When your computer connects to other Hermod peers:

- your IP address and your PeerId;
- the spaces you take part in, as network identifiers for routing, and when you are online;
- encrypted blobs and events. Only members of a space hold its key and can read its content.

Members of a space can see what you post in it, including your profile and the time of your activity.

Peers that relay for you see that traffic passes through, its size and timing, and the two endpoints, but not its content.

## 5. What third parties see

- Public IPFS bootstrap nodes: your IP address and PeerId when you look for peers.
- Public STUN servers (Google): your IP address when a voice or video connection is set up.
- GitHub: your IP address when you download Hermod or check for updates, under GitHub's own privacy policy.

## 6. Telemetry and analytics

None. Hermod does not send usage data, crash reports, or analytics to anyone. The project website has no analytics and no cookies. Invite codes in website links are in the URL fragment, which your browser never sends to a server; the page reads them locally.

## 7. Resource sharing

If you consent, Hermod relays encrypted traffic and keeps encrypted copies for others within the limits in the Terms (section 8). This does not give us or other peers access to your files or your other network traffic.

## 8. Retention and deletion

Data stays on your device until you leave a space, delete it, or uninstall Hermod and remove its data folder. Copies on other members' devices, and encrypted copies cached by other peers, cannot be recalled and may remain.

## 9. Security

Content is encrypted with a per-space key, events are signed, and transport uses Noise. No system is perfectly secure. Anyone with a space's invite code or key can read that space. There is no member removal or re-keying in this version.

## 10. Children

Hermod is not for children under 13, or under 16 in the European Union or where local law sets a higher age.

## 11. Your rights

Because we hold no personal data about you, there is nothing for us to export, correct, or erase. You control your data on your device. For data held by other members, ask them.

## 12. Changes

When this notice changes, its version changes and Hermod asks you to accept it again.

## 13. Contact

https://github.com/hotocoo/hermod/issues. Security issues: GitHub security advisories on the same repository.
