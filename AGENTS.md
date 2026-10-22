<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## rtk command pattern (permanent)

Prefix shell commands with `rtk --ultra-compact` (flag MUST come before the subcommand). rtk 0.50.0 only accepts its own subcommands — arbitrary commands like `rtk pwd` exit 127 with `rtk: No such file or directory`.

- Known tools: `rtk --ultra-compact ls`, `... git status`, `... grep`, `... cargo build`, `... vitest`
- Anything else: `rtk --ultra-compact run '<cmd>'` (sh -c) or `rtk --ultra-compact proxy <cmd>` (unfiltered, tracked)
- Interactive shells get the flag auto-injected via the `rtk` function in `~/.local/bin/rtk-uc.sh` (sourced from `.zshrc`/`.bashrc`/`.profile`); non-login tool shells still need the explicit flag.
