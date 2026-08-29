# Labels Pro

Many-to-many thread labels for BB. Separate from Tasks Pro task labels — this
plugin tags **threads**, stores everything in the plugin SQLite database, and
exposes a stable RPC surface for sibling plugins.

**Siblings:** [Sidebar Pro](https://github.com/kr3t3n/bb-plugin-sidebar-pro) ·
[Notifications Pro](https://github.com/kr3t3n/bb-plugin-notifications-pro)

## Features

- **Labels CRUD** — create, rename, delete; slug is derived from the name
- **Thread assign** — a thread can hold many labels; assign/unassign are
  idempotent
- **Filter** — list thread ids for a label (poll or subscribe to realtime)
- **Mark all read by label** — uses `bb.sdk.threads.markRead` for each linked
  thread (agent-facing bulk attention cleanup)
- **Automation auto-tag** — on `thread.created`, if `originPluginId ===
  "automations"`, assign a configurable default label (default `automation`)
- **Task-project auto-tag** — threads attached to Tasks get a label named after
  the Tasks project (toggle in Settings)
- **Backfill** — `bb labels backfill-automations` /
  `bb labels backfill-task-projects` for existing threads
- **Thread header editor** — `experimental_threadHeaderAction` chip shows
  current labels; popover toggles many labels and creates new ones inline
  (per-pane `threadId` state for split layouts)

## Install

Requires `bb >= 0.40` and `bbPluginSdk >= 0.4.21` (see `package.json`
`engines`). Path install:

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

Consumers (Sidebar Pro, Notifications Pro) treat a missing or disabled Labels
Pro as **graceful absence** — they hide label UI / mute-by-label and keep
working. They do **not** declare Labels Pro as a hard dependency in `engines`.

## Configure

Settings → Labels Pro, or:

```sh
bb plugin config labels-pro
bb plugin config labels-pro set autoTagAutomations true
bb plugin config labels-pro set automationLabelName automation
bb plugin config labels-pro set autoTagTaskProjects true
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
bb labels backfill-task-projects [--dry-run] [--json]
```

The skill in `skills/labels/SKILL.md` documents these for agents.

## RPC for siblings

Canonical contract: [docs/rpc-contract.md](docs/rpc-contract.md).

| | |
| --- | --- |
| Plugin id | `labels-pro` |
| Realtime channel | `labels` |
| Primary consumer methods | `listLabels`, `listThreadsByLabel`, `getThreadLabels`, `assignLabel`, `unassignLabel`, `createLabel`, `markAllReadByLabel` |

Sidebar Pro uses `listLabels` + `listThreadsByLabel` for filter/chips and
mark-filtered-read. Notifications Pro uses the same pair (plus optional bulk
assignment probes) for mute-by-label. Both catch 404/unavailable and degrade.

## Manual test checklist (Pro stack)

With Labels Pro, Sidebar Pro, and Notifications Pro installed and enabled:

1. **Auto-tag** — run an automation (or enable auto-tag +
   `bb labels backfill-automations`); confirm the `automation` label appears on
   the worker thread (`bb labels for-thread <id>` and the thread header chip).
2. **Filter / hide** — in Sidebar Pro, open the label filter; Only / Hide the
   automation (or another) label; confirm the list updates.
3. **Mark filtered / quiet clear** — with a label filter active, use Sidebar Pro
   mark-all-read; only matching attention threads clear. Confirm bell badge.
4. **Muted notifications** — Settings → Notifications Pro → Mute labels → mute
   `automation`; trigger attention on a muted thread; confirm no OS toast /
   push / center edge for that thread. Unmute and confirm alerts resume.
5. **Header edit** — open a thread (try a split pane too); use the Labels chip
   in the header to add/remove labels and create one inline; confirm Sidebar
   chips and `bb labels for-thread` match.

Disable Labels Pro (or uninstall) and confirm Sidebar hides the label filter /
chips and Notifications mute panel reports Labels Pro unavailable without
breaking either plugin.

## Layout

- `server.ts` — settings, SQLite, RPC, CLI, automation `thread.created` hook
- `app.tsx` — Labels nav panel, settings help, thread-header label editor
- `src/ThreadLabelsChip.tsx` — per-thread header popover (add/remove/create)
- `src/labels-db.ts` — SQLite helpers (unit-tested)
- `src/rpc-contract.ts` — shared Zod RPC contract
- `skills/labels/` — agent skill for `bb labels`
- `docs/rpc-contract.md` — sibling integration contract
- `assets/icon.svg` — stroked tag icon (matches Sidebar / Notifications Pro)
