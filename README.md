# Hermod

Hermod is a desktop app where every install is also a small peer in an encrypted mesh. Chat, share and plan with friends in private spaces. There is no central server, no account, and no telemetry.

Built with Tauri v2, Next.js and Rust (libp2p). Licensed under Apache-2.0.

Website and downloads: https://hotocoo.github.io/hermod/

![The island town of a Space called Lantern Makers, with the Commons, Gallery and Workshop raised](docs/screenshots/town.jpg)

## What is inside

Every Space is an island town. Each building is one part of the Space, and it grows as members use it.

### Talk

| Chat in the Commons | Direct messages |
|---|---|
| ![Chat in the Commons between two members, with a heart reaction](docs/screenshots/chat.jpg) | ![A one-to-one conversation between Ada and Bo, three synced messages](docs/screenshots/direct-messages.jpg) |
| Channels, threads, reactions, markdown, code blocks and spoilers. | One-to-one and group DMs, synced straight between devices. |

| The Hearth | Ravens |
|---|---|
| ![A Hearth meeting called Saturday market prep with both peers, an agenda and a shared note](docs/screenshots/hearth.jpg) | ![The Rookery drawer listing raven letters from Bo](docs/screenshots/rookery.jpg) |
| Voice and video calls peer to peer. A call becomes a meeting with an agenda, shared notes and recording. | Messages from your other Spaces arrive as letters carried by ravens. |

### Share

| The Gallery feed | The Loom (Skein) |
|---|---|
| ![The Gallery feed with two photo posts and a note](docs/screenshots/feed.jpg) | ![The Skein ledger with a sealed snapshot, an image file and a text diff](docs/screenshots/skein.jpg) |
| Photos, notes and stories, with media sent over the mesh. | Versioned file snapshots with signed seals and line diffs. |

### Plan and work

| Board | Docs | Calendar |
|---|---|---|
| ![A task board in the Workshop with cards in To do and Doing](docs/screenshots/board.jpg) | ![The Lantern care manual doc with a to-do list and its version history](docs/screenshots/docs.jpg) | ![The calendar week view with Saturday market setup and a Join in the Hearth button](docs/screenshots/calendar.jpg) |

| The Counting House | The Games Hall |
|---|---|
| ![The help desk with three open tickets and a reply on the selected one](docs/screenshots/desk.jpg) | ![A chess game in progress between Ada and Bo](docs/screenshots/arcade.jpg) |
| A help desk: tickets, assignees, replies and satisfaction. | Chess, connect four, polls, quizzes, kudos and more, played live between members. |

### Find and control

| Search | All your Spaces | Network |
|---|---|---|
| ![The search results page for lantern, with hits across a snapshot, a message, a post and a doc](docs/screenshots/search.jpg) | ![The archipelago view with a shared island and a personal Home island](docs/screenshots/islands.jpg) | ![The network drawer with peers, bandwidth and the What you share sliders](docs/screenshots/network.jpg) |

Screenshots are taken headless from the real app (two local peers, content typed through the UI) with `npm run shots`.

## Install

Download the installer for your system from the [latest release](https://github.com/hotocoo/hermod/releases/latest). Early builds are not code-signed, so your system will warn you once.

- **macOS:** right-click the app, choose Open, then Open again. Or run `xattr -dr com.apple.quarantine /Applications/Hermod.app`.
- **Windows:** when SmartScreen appears, click "More info", then "Run anyway".
- **Linux:** `chmod +x Hermod_*.AppImage` and run it, or install the `.deb`.

Hermod checks GitHub for signed updates.

## How the mesh works

- Each install has its own identity key. Each space has a random key held only by its members.
- Every change is a signed, encrypted event. Members sync events directly with each other.
- Peers find each other on the local network, through public IPFS bootstrap nodes, and through addresses inside invite codes. Peers that are publicly reachable can relay encrypted traffic for others. Relays cannot read it.
- There is no public directory or search for spaces: you join one only with an invite from a member.
- Invite links look like `https://hotocoo.github.io/hermod/join#<code>`. The code is in the fragment, so it never leaves your browser, and the page opens `hermod://join/<code>` in the app.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Known limits

- Two users behind symmetric NATs may fail to connect until a reachable Hermod peer is online.
- Public IPFS bootstrap nodes and public STUN servers are third-party services.
- A removed member keeps whatever they had already synced before the removal.

## Resource sharing

With your consent, Hermod uses some CPU, bandwidth and disk to relay encrypted traffic and keep encrypted copies for spaces you are in. Defaults: 8 relay circuits, 256 KiB/s relay bandwidth, 64 MiB per circuit, 512 MiB cache for others, 64 connections. You can lower these or switch relaying off in settings. This may count against your data plan, so check your ISP terms. Full text: [legal/TERMS.md](legal/TERMS.md), [legal/PRIVACY.md](legal/PRIVACY.md).

## Build from source

Requirements: Node 22+, Rust 1.90+, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
npm ci
npm run tauri dev      # run the app
npm run tauri build    # build installers
cargo test --workspace
npx playwright test    # UI end-to-end tests
```

## Release process

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `crates/hermod-core/Cargo.toml` and `crates/hermod-node/Cargo.toml`. The release fails if the tag and any of these disagree.
2. Tag and push: `git tag -a vX.Y.Z -m "Hermod vX.Y.Z" && git push origin vX.Y.Z`. Tags with a suffix such as `-beta.1` are published as pre-releases.
3. The `release` workflow runs the Rust and web checks (the end-to-end suite runs on every push to `main` instead), then builds macOS (Apple silicon and Intel), Linux and Windows installers, signs updater artifacts, and publishes the release with `latest.json`.

Repository secrets needed: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty if the key has none). Optional for macOS signing: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.

## Legal

The legal texts are written for a personal open-source project. This text is not legal advice; have it reviewed before relying on it.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
