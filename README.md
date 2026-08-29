# Labels Pro

Many-to-many thread labels for BB. Separate from Tasks Pro task labels — this
plugin tags **threads**, stores everything in the plugin SQLite database, and
exposes a stable RPC surface for Sidebar Pro / Notifications Pro.

## Features

- **Labels CRUD** — create, rename, delete; slug is derived from the name
- **Thread assign** — a thread can hold many labels; assign/unassign are
  idempotent
- **Filter** — list thread ids for a label (poll or subscribe to realtime)
- **Mark all read by label** — uses `bb.sdk.threads.markRead` for each linked
  thread (agent-facing bulk attention cleanup)
- **Thread header editor** — `experimental_threadHeaderAction` chip shows
  current labels; popover toggles many labels and creates new ones inline
  (per-pane `threadId` state for split layouts)

## Install

```sh
npm install --include=dev
bb plugin build
bb plugin install /home/bb/plugins/bb-plugin-labels-pro --yes
bb plugin reload labels-pro
```

Dev loop:

```sh
bb plugin dev
```

## Configure

Settings → Labels Pro, or:

```sh
bb plugin config labels-pro
bb plugin config labels-pro set autoTagAutomations true
bb plugin config labels-pro set automationLabelName automation
```

## CLI overview

```sh
bb labels list [--json]
bb labels create <name> [--color <color>] [--json]
bb labels rename <id-or-name> <new-name> [--json]
bb labels delete <id-or-name> [--json]
bb labels assign <thread-id> <id-or-name> [--json]
bb labels unassign <thread-id> <id-or-name> [--json]
bb labels for-thread <thread-id> [--json]
bb labels threads <id-or-name> [--json]
bb labels mark-read <id-or-name> [--json]
bb labels backfill-automations [--dry-run] [--project <id>] [--json]
```

The skill in `skills/labels/SKILL.md` documents these for agents.

## RPC for siblings

See [docs/rpc-contract.md](docs/rpc-contract.md). Plugin id: `labels-pro`.
Realtime channel: `labels`.

## Layout

- `server.ts` — settings, SQLite, RPC, CLI, automation `thread.created` hook
- `app.tsx` — Labels nav panel, settings help, thread-header label editor
- `src/ThreadLabelsChip.tsx` — per-thread header popover (add/remove/create)
- `src/labels-db.ts` — SQLite helpers (unit-tested)
- `src/rpc-contract.ts` — shared Zod RPC contract
- `skills/labels/` — agent skill for `bb labels`
- `docs/rpc-contract.md` — sibling integration contract
- `assets/icon.svg` — stroked tag icon (matches Sidebar / Notifications Pro)
