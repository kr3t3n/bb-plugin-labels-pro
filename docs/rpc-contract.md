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

### Consumer map

| Plugin | Uses | Graceful fallback |
| --- | --- | --- |
| Sidebar Pro | `listLabels`, `listThreadsByLabel`, realtime `labels` | Hide label filter + row chips; list unchanged |
| Notifications Pro | `listLabels`, `listThreadsByLabel` (optional bulk probe if present) | Mute-by-label UI shows “unavailable”; alerts still work |
| Labels Pro UI | full table + `getThreadLabels` / assign / create in header chip | n/a (owner) |

Notes:

- `assignLabel` / `createLabel` are idempotent by label name (case-insensitive).
- `assignLabel` / `unassignLabel` are idempotent for a given `(threadId, labelId)`.
- Do not mutate core bb thread rows for labels; this plugin owns the join table.
- Task-project auto-tag uses the Tasks project **name** as the label (via
  `bb.sdk.plugins.callRpc` to plugin `tasks`).
- There is **no** required `listAssignments` bulk method today. Consumers that
  probe for one must fall back to `listThreadsByLabel` per muted/filter label.
