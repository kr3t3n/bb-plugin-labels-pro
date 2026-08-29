---
name: labels
description: Manage BB thread labels with the Labels Pro `bb labels` CLI. Use when creating, renaming, deleting, assigning, or filtering labels; when marking all threads with a label as read; or when backfilling automation tags.
---

# Labels Pro

Labels Pro stores many-to-many thread labels in the plugin database (not on core
bb thread rows). The Labels nav page, `bb labels` CLI, and RPC share one store.

## Commands

| Command | Effect |
| --- | --- |
| `bb labels list` | List every label (id, name, slug). |
| `bb labels create <name> [--color <color>]` | Create a label (idempotent by name). |
| `bb labels rename <id-or-name> <new-name>` | Rename a label. |
| `bb labels delete <id-or-name>` | Delete a label and its thread links. |
| `bb labels assign <thread-id> <id-or-name>` | Assign a label (creates the label if the name is new). |
| `bb labels unassign <thread-id> <id-or-name>` | Remove a label from a thread. |
| `bb labels for-thread <thread-id>` | List labels on one thread. |
| `bb labels threads <id-or-name>` | List thread ids that have the label. |
| `bb labels mark-read <id-or-name>` | Mark every thread with that label as read. |
| `bb labels backfill-automations [--dry-run] [--project <id>]` | Tag existing `originPluginId=automations` threads. |

Add `--json` to any command when the output drives code.

## Procedure

1. Run `bb labels list` (or `bb labels for-thread <id>`) before changing data.
2. Prefer stable label names (`automation`, `bug`, `customer`) over one-offs.
3. Assign with `bb labels assign <thread-id> <name>` — never edit the plugin DB.
4. For bulk attention cleanup, use `bb labels mark-read <name>`.
5. After enabling automation auto-tag, run `bb labels backfill-automations` once
   for older automation threads.

## Rules

- Change labels only through `bb labels` or the Labels Pro RPC — not by editing
  bb.db or plugin storage files.
- A thread may have multiple labels.
- Automation threads auto-tag when Settings → Labels Pro → Auto-tag is on
  (default label name `automation`).
