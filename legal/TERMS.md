---
title: Terms of Use
version: "2026-10-15"
---

# Hermod Terms of Use

Version 2026-10-15

This text is not legal advice; have it reviewed before relying on it.

## 1. Who these terms are between

These terms are an agreement between you ("you", "the user") and the Hermod contributors ("we", "us"). The Hermod contributors are the individuals who write and publish Hermod as an open-source project. There is no company, and nobody operates a service for you. By using Hermod you accept these terms.

## 2. What Hermod is

Hermod is a desktop program. Every install is also a small peer in a peer-to-peer mesh. There is no central server.

- Your data is stored on your device and on the devices of the other members of the spaces you join, encrypted.
- Other peers may carry (relay) encrypted traffic for you. They cannot read it.
- We cannot read, recover, moderate, or delete your content, because we never receive it.

## 3. Software provided as is

Hermod is provided "as is" and "as available", without warranty of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not promise that it will be free of bugs, always connect, keep your data safe, or keep working.

## 4. Limitation of liability

To the maximum extent allowed by law, the Hermod contributors are not liable for any indirect, incidental, special, consequential, or punitive damages, or for loss of data, profits, or goodwill, arising from your use of or inability to use Hermod. Where liability cannot be excluded, it is limited to the amount you paid for Hermod, which is zero. Nothing here limits liability that cannot be limited by law.

## 5. Acceptable use

You must not use Hermod to:

- create, share, or store content that is illegal where you or the recipients live;
- harass, threaten, stalk, or abuse other people;
- create, share, or store child sexual abuse material. We have zero tolerance for this. Report it to your local authorities;
- distribute malware, or attack other people's devices or networks;
- impersonate others to deceive them, or violate other people's rights.

If you break these rules you must stop, and you may no longer use Hermod. Because Hermod has no central server, we cannot remove content or ban accounts. Members of a space are the ones who can decide who they share with.

## 6. Your content and your responsibility

You are responsible for everything you create, post, or share in Hermod, and for the people you invite. Anyone who holds a valid invite code can join the space it belongs to. Invite codes cannot be revoked in this version, and members cannot be removed or re-keyed. Share invite codes only with people you trust.

You keep ownership of your content. By sharing it into a space you allow the other members' devices to store and display it.

## 7. Peer-to-peer nature

- There is no central server run by us.
- Spaces are synchronized directly between members' devices, encrypted with a key held by the members.
- Relay peers, which may be other users' computers, carry encrypted traffic they cannot read. They can see metadata such as IP addresses and PeerIds (see the Privacy Notice).
- Anything shared with other members may remain on their devices. We cannot recall it.

## 8. Resource sharing (separate consent)

This clause is shown to you separately and needs its own consent. If you do not agree, do not start Hermod's network node.

By agreeing, you allow Hermod to use some of your computer's CPU, network bandwidth, and disk storage to:

- relay encrypted traffic for other peers, which may include people you do not know. You cannot read it and neither can they;
- keep encrypted copies of data for spaces you are a member of, and cache encrypted data for others, so that members can sync when others are offline.

Default limits (you can lower them, or switch relaying off, in settings; hard ceilings apply):

| Resource | Default | Ceiling |
|---|---|---|
| Relay circuits | 8 | 32 |
| Relay bandwidth | 256 KiB/s | 2 MiB/s |
| Relay bytes per circuit | 64 MiB | none |
| Encrypted cache held for others | 512 MiB | 4 GiB |
| Connections | 64 | 256 |
| CPU | network tasks on a 2-thread runtime | none |

Relaying pauses when your computer is on battery, where Hermod can detect it, or when you switch it off.

Relaying and syncing use your internet connection. This may count against your data plan and may be restricted by your internet provider's terms. Check your provider's terms before you agree, especially on metered or capped connections.

## 9. Third-party services

Hermod uses services we do not run and do not control:

- public IPFS bootstrap nodes, to help your computer find other peers;
- public STUN servers (operated by Google), to help voice and video connect through routers;
- GitHub, to download Hermod and to check for updates.

These services have their own terms and privacy practices, and they see your IP address when you contact them.

## 10. Privacy

The Privacy Notice explains what data exists and who sees it. It is part of these terms.

## 11. Ending your use and deletion

You can stop at any time. Leave a space in the app, or uninstall Hermod and delete its data folder, to remove data from your device. Copies already stored on other members' devices cannot be recalled or deleted by us or by you.

## 12. Children

Hermod is not for children under 13, or under 16 in the European Union or where local law sets a higher age. If you are below that age, do not use Hermod.

## 13. Changes to these terms

We may publish new versions of these terms. When the version changes, Hermod asks you to read and accept the new version before the network node starts again. If you do not accept, you should stop using Hermod.

## 14. Open-source license

The Hermod source code is licensed under the Apache License 2.0 (see the LICENSE file). These terms govern your use of the built application. The license governs your rights to the code. Where they conflict about the code, the license wins.

## 15. Governing law

No governing law or venue is specified in these terms.

## 16. Contact

Questions and reports: https://github.com/hotocoo/hermod/issues. Security issues: use GitHub security advisories on the same repository.
