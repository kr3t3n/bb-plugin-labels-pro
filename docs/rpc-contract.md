# Labels Pro RPC contract

Stable wire surface for sibling plugins ([Sidebar Pro](https://github.com/kr3t3n/bb-plugin-sidebar-pro),
[Notifications Pro](https://github.com/kr3t3n/bb-plugin-notifications-pro), and
others). Plugin id: `labels-pro`.

**Source of truth for schemas:** `src/rpc-contract.ts`. Consumers should treat
Labels Pro as optional: catch RPC 404 / unavailable and hide label UI rather
than hard-failing install.

Realtime channel: `labels` (constant `LABEL_REALTIME_CHANNEL`).

Payload shapes (best-effort; always refetch after a signal):

| `type` | Fields |
| --- | --- |
| `label-created` | `label` |
| `label-renamed` | `label` |
| `label-deleted` | `labelId` |
| `assigned` | `threadId`, `label` |
| `unassigned` | `threadId`, `labelId` |
| `thread-labels-set` | `threadId`, `labels`, `added`, `removed` |

## Label object

```ts
{
  id: string;
  name: string;
  slug: string;
  color: string | null;
  createdAt: number; // ms epoch
  updatedAt: number;
}
```

## Methods

Call via `bb.sdk.plugins.callRpc({ pluginId: "labels-pro", method, input, outputSchema })`
or the app `useRpc` hook inside this plugin. Sibling app code often POSTs
`/api/v1/plugins/labels-pro/rpc/<method>` (same envelopes).

| Method | Input | Output |
| --- | --- | --- |
| `listLabels` | `null` | `{ labels }` |
| `createLabel` | `{ name, color? }` | `{ label, created }` |
| `renameLabel` | `{ id, name, color? }` | `{ label }` |
| `deleteLabel` | `{ id }` | `{ removed }` |
| `getThreadLabels` | `{ threadId }` | `{ labels }` |
| `assignLabel` | `{ threadId, labelId? \| labelName? }` | `{ label, assigned }` |
| `unassignLabel` | `{ threadId, labelId? \| labelName? }` | `{ removed, labelId }` |
| `setThreadLabels` | `{ threadId, labelIds }` | `{ labels, added, removed }` |
| `listThreadsByLabel` | `{ labelId? \| labelName? }` | `{ label, threadIds }` |
| `markAllReadByLabel` | `{ labelId? \| labelName? }` | `{ label, attempted, marked, failed[] }` |
| `backfillAutomations` | `{ dryRun?, projectId? }` | `{ label, scanned, assigned, alreadyLabeled, dryRun }` |
| `backfillTaskProjects` | `{ dryRun? }` | `{ scanned, assigned, alreadyLabeled, skipped, dryRun, byProject[] }` |
| `listAssignments` | `{ sinceRevision? }` | `{ revision, changed, labels \| null, assignments \| null }` |
| `subscribeChanges` | `{ method }` | `{ revision }` |
| `unsubscribeChanges` | `{}` | `{ removed }` |

### Bulk reads and the revision

Labels Pro stores one revision number. Database triggers raise it on every
write to a label or an assignment, from any path (RPC, CLI, backfills, a
label delete that removes its assignments). The number is stored, so it does
not restart at zero after a reload.

`listAssignments` returns every label and every assignment in one call:
`assignments` is `[{ labelId, threadIds }]`, in label-name order. Pass the
`revision` from the previous reply as `sinceRevision`. When nothing changed,
the reply is `{ revision, changed: false, labels: null, assignments: null }`.
Use this call, not one `listThreadsByLabel` call per label.

### Change notifications for sibling plugins

The bb app delivers a realtime signal only to the plugin that published it.
A sibling plugin's frontend therefore never receives the `labels` channel.
Use a server subscription instead:

1. Your server calls `subscribeChanges({ method })` through
   `bb.sdk.plugins.callRpc`. Labels Pro rejects calls that do not come from a
   plugin. It stores one subscription per plugin, so calling again is safe;
   call it on each load.
2. After label writes, Labels Pro waits 250 ms to collect a burst, then calls
   `method` on your plugin with:

   ```ts
   {
     revision: number;
     // Full current label ids of each thread that changed ([] = none left).
     threads: Record<string, string[]>;
     // A label was created, renamed or deleted, or the burst was larger than
     // 500 threads: reload with listAssignments.
     labelsChanged: boolean;
   }
   ```
3. Your server publishes that value on its own realtime channel. Your
   frontend applies `threads` to its map, or reloads when `labelsChanged` is
   true. After a realtime reconnect, reload with `listAssignments` and your
   last revision, because signals sent while disconnected are lost.

`unsubscribeChanges({})` removes your plugin's subscription.

### Consumer map

| Plugin | Uses | Graceful fallback |
| --- | --- | --- |
| Sidebar Pro | `listAssignments`, `subscribeChanges` (through its server); older Labels Pro: `listLabels` + `listThreadsByLabel` per label | Hide label filter + row chips; list unchanged |
| Notifications Pro | `listLabels`, `listThreadsByLabel`. Its bulk probe expects an older draft shape (`assignments: [{ threadId, labelIds }]`), fails on `listAssignments`, and falls back | Mute-by-label UI shows “unavailable”; alerts still work |
| Labels Pro UI | full table + `getThreadLabels` / assign / create in header chip | n/a (owner) |

Notes:

- `assignLabel` / `createLabel` are idempotent by label name (case-insensitive).
- `assignLabel` / `unassignLabel` are idempotent for a given `(threadId, labelId)`.
- Do not mutate core bb thread rows for labels; this plugin owns the join table.
- Task-project auto-tag uses the Tasks project **name** as the label (via
  `bb.sdk.plugins.callRpc` to plugin `tasks`).
- `listAssignments` exists from this version. Consumers that must work with
  older Labels Pro builds fall back to `listThreadsByLabel` per label.
