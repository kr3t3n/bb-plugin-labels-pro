# Labels Pro RPC contract

Stable wire surface for sibling plugins (Sidebar Pro, Notifications Pro, and
others). Plugin id: `labels-pro`.

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
or the app `useRpc` hook inside this plugin.

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

Notes:

- `assignLabel` / `createLabel` are idempotent by label name (case-insensitive).
- `assignLabel` / `unassignLabel` are idempotent for a given `(threadId, labelId)`.
- Do not mutate core bb thread rows for labels; this plugin owns the join table.
- Source of truth for schemas: `src/rpc-contract.ts`.
