// bb-plugin-labels-pro — backend: SQLite labels, RPC, CLI, automation auto-tag.
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  LABEL_MIGRATIONS,
  assignLabel,
  createLabel,
  deleteLabel,
  ensureLabelByName,
  getLabelById,
  getLabelByName,
  listLabels,
  listLabelsForThread,
  listThreadIdsByLabel,
  renameLabel,
  setThreadLabels,
  unassignLabel,
  type LabelsDb,
  type LabelRow,
} from "./src/labels-db";
import {
  LABEL_REALTIME_CHANNEL,
  labelSchema,
  rpcContract,
} from "./src/rpc-contract";

// Re-export for app.tsx / docs consumers that import from the server entry.
export { LABEL_REALTIME_CHANNEL, labelSchema, rpcContract };
export type { LabelDto } from "./src/rpc-contract";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

const AUTOMATIONS_PLUGIN_ID = "automations";

type RealtimePayload =
  | { type: "label-created"; label: LabelRow }
  | { type: "label-renamed"; label: LabelRow }
  | { type: "label-deleted"; labelId: string }
  | { type: "assigned"; threadId: string; label: LabelRow }
  | { type: "unassigned"; threadId: string; labelId: string }
  | {
      type: "thread-labels-set";
      threadId: string;
      labels: LabelRow[];
      added: string[];
      removed: string[];
    };

function publish(bb: BbPluginApi, payload: RealtimePayload): void {
  bb.realtime.publish(LABEL_REALTIME_CHANNEL, payload);
}

function resolveLabel(
  db: LabelsDb,
  input: { labelId?: string; labelName?: string },
): LabelRow | null {
  if (input.labelId) return getLabelById(db, input.labelId);
  if (input.labelName) return getLabelByName(db, input.labelName);
  return null;
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    autoTagAutomations: {
      type: "boolean",
      label: "Auto-tag automation threads",
      description:
        "When an automation spawns a thread (originPluginId=automations), assign the default label.",
      default: true,
    },
    automationLabelName: {
      type: "string",
      label: "Automation label name",
      description:
        "Label assigned to automation-origin threads. Created on first use if missing.",
      default: "automation",
    },
  });

  const db = bb.storage.database() as Db & LabelsDb;
  bb.storage.migrate(db, LABEL_MIGRATIONS);

  async function automationLabel(): Promise<LabelRow> {
    const cfg = await settings.get();
    const name =
      typeof cfg.automationLabelName === "string" &&
      cfg.automationLabelName.trim().length > 0
        ? cfg.automationLabelName.trim()
        : "automation";
    const { label, created } = ensureLabelByName(db, name);
    if (created) {
      publish(bb, { type: "label-created", label });
    }
    return label;
  }

  async function maybeAutoTag(thread: {
    id: string;
    originPluginId?: string | null;
  }): Promise<void> {
    if (thread.originPluginId !== AUTOMATIONS_PLUGIN_ID) return;
    const cfg = await settings.get();
    if (!cfg.autoTagAutomations) return;
    const label = await automationLabel();
    const result = assignLabel(db, {
      threadId: thread.id,
      labelId: label.id,
    });
    if (result.assigned) {
      publish(bb, {
        type: "assigned",
        threadId: thread.id,
        label,
      });
    }
  }

  bb.events.on("thread.created", ({ thread }) => {
    void maybeAutoTag(thread).catch((error) => {
      const message =
        error instanceof Error ? error.message : "auto-tag failed";
      bb.log.warn(`automation auto-tag failed: ${message}`);
    });
  });

  bb.rpc.register(rpcContract, {
    listLabels: () => ({ labels: listLabels(db) }),
    createLabel: (input) => {
      const { label, created } = createLabel(db, {
        name: input.name,
        color: input.color ?? null,
      });
      if (created) publish(bb, { type: "label-created", label });
      return { label, created };
    },
    renameLabel: (input) => {
      const label = renameLabel(db, {
        id: input.id,
        name: input.name,
        color: input.color,
      });
      publish(bb, { type: "label-renamed", label });
      return { label };
    },
    deleteLabel: ({ id }) => {
      const removed = deleteLabel(db, id);
      if (removed) publish(bb, { type: "label-deleted", labelId: id });
      return { removed };
    },
    getThreadLabels: ({ threadId }) => ({
      labels: listLabelsForThread(db, threadId),
    }),
    assignLabel: (input) => {
      let label: LabelRow | null = null;
      if (input.labelId) {
        label = getLabelById(db, input.labelId);
        if (!label) throw new Error(`No label with id ${input.labelId}`);
      } else if (input.labelName) {
        const ensured = ensureLabelByName(db, input.labelName);
        label = ensured.label;
        if (ensured.created) {
          publish(bb, { type: "label-created", label });
        }
      }
      if (!label) throw new Error("labelId or labelName is required");
      const result = assignLabel(db, {
        threadId: input.threadId,
        labelId: label.id,
      });
      if (result.assigned) {
        publish(bb, {
          type: "assigned",
          threadId: input.threadId,
          label,
        });
      }
      return { label, assigned: result.assigned };
    },
    unassignLabel: (input) => {
      const label = resolveLabel(db, input);
      if (!label) {
        return { removed: false, labelId: input.labelId ?? null };
      }
      const { removed } = unassignLabel(db, {
        threadId: input.threadId,
        labelId: label.id,
      });
      if (removed) {
        publish(bb, {
          type: "unassigned",
          threadId: input.threadId,
          labelId: label.id,
        });
      }
      return { removed, labelId: label.id };
    },
    setThreadLabels: (input) => {
      const result = setThreadLabels(db, input);
      publish(bb, {
        type: "thread-labels-set",
        threadId: input.threadId,
        labels: result.labels,
        added: result.added,
        removed: result.removed,
      });
      return result;
    },
    listThreadsByLabel: (input) => {
      const label = resolveLabel(db, input);
      if (!label) return { label: null, threadIds: [] };
      return {
        label,
        threadIds: listThreadIdsByLabel(db, label.id),
      };
    },
    async markAllReadByLabel(input) {
      const label = resolveLabel(db, input);
      if (!label) {
        return { label: null, attempted: 0, marked: 0, failed: [] };
      }
      const threadIds = listThreadIdsByLabel(db, label.id);
      let marked = 0;
      const failed: { threadId: string; error: string }[] = [];
      for (const threadId of threadIds) {
        try {
          await bb.sdk.threads.markRead({ threadId });
          marked += 1;
        } catch (error) {
          failed.push({
            threadId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return {
        label,
        attempted: threadIds.length,
        marked,
        failed,
      };
    },
    async backfillAutomations(input) {
      const label = await automationLabel();
      let offset = 0;
      const limit = 100;
      let scanned = 0;
      let assigned = 0;
      let alreadyLabeled = 0;
      for (;;) {
        // threads.list returns Thread[] (not { threads }).
        const threads = await bb.sdk.threads.list({
          projectId: input.projectId,
          originPluginId: AUTOMATIONS_PLUGIN_ID,
          includeHidden: true,
          limit,
          offset,
        });
        if (threads.length === 0) break;
        for (const thread of threads) {
          scanned += 1;
          if (input.dryRun) {
            const has = listLabelsForThread(db, thread.id).some(
              (l) => l.id === label.id,
            );
            if (has) alreadyLabeled += 1;
            else assigned += 1;
            continue;
          }
          const result = assignLabel(db, {
            threadId: thread.id,
            labelId: label.id,
          });
          if (result.assigned) {
            assigned += 1;
            publish(bb, {
              type: "assigned",
              threadId: thread.id,
              label,
            });
          } else {
            alreadyLabeled += 1;
          }
        }
        if (threads.length < limit) break;
        offset += threads.length;
      }
      return {
        label,
        scanned,
        assigned,
        alreadyLabeled,
        dryRun: input.dryRun,
      };
    },
  });

  const usage = [
    "Usage:",
    "  bb labels list [--json]",
    "  bb labels create <name> [--color <color>] [--json]",
    "  bb labels rename <id-or-name> <new-name> [--json]",
    "  bb labels delete <id-or-name> [--json]",
    "  bb labels assign <thread-id> <id-or-name> [--json]",
    "  bb labels unassign <thread-id> <id-or-name> [--json]",
    "  bb labels threads <id-or-name> [--json]",
    "  bb labels for-thread <thread-id> [--json]",
    "  bb labels mark-read <id-or-name> [--json]",
    "  bb labels backfill-automations [--dry-run] [--project <id>] [--json]",
  ].join("\n");

  function findLabelArg(token: string): LabelRow | null {
    return getLabelById(db, token) ?? getLabelByName(db, token);
  }

  function formatLabel(label: LabelRow): string {
    const color = label.color ? `  color=${label.color}` : "";
    return `${label.id}  ${label.name}  (${label.slug})${color}`;
  }

  bb.cli.register({
    name: "labels",
    summary: "Manage Labels Pro thread labels",
    commands: [
      { name: "list", summary: "List labels", usage: "bb labels list [--json]" },
      {
        name: "create",
        summary: "Create a label",
        usage: "bb labels create <name> [--color <color>] [--json]",
      },
      {
        name: "rename",
        summary: "Rename a label",
        usage: "bb labels rename <id-or-name> <new-name> [--json]",
      },
      {
        name: "delete",
        summary: "Delete a label",
        usage: "bb labels delete <id-or-name> [--json]",
      },
      {
        name: "assign",
        summary: "Assign a label to a thread",
        usage: "bb labels assign <thread-id> <id-or-name> [--json]",
      },
      {
        name: "unassign",
        summary: "Remove a label from a thread",
        usage: "bb labels unassign <thread-id> <id-or-name> [--json]",
      },
      {
        name: "threads",
        summary: "List thread ids for a label",
        usage: "bb labels threads <id-or-name> [--json]",
      },
      {
        name: "for-thread",
        summary: "List labels on a thread",
        usage: "bb labels for-thread <thread-id> [--json]",
      },
      {
        name: "mark-read",
        summary: "Mark all threads with a label as read",
        usage: "bb labels mark-read <id-or-name> [--json]",
      },
      {
        name: "backfill-automations",
        summary: "Assign the automation label to existing automation threads",
        usage:
          "bb labels backfill-automations [--dry-run] [--project <id>] [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const dryRun = argv.includes("--dry-run");
      const filtered = argv.filter(
        (arg) => arg !== "--json" && arg !== "--dry-run",
      );
      const projectIdx = filtered.indexOf("--project");
      let projectId: string | undefined;
      if (projectIdx >= 0) {
        projectId = filtered[projectIdx + 1];
        filtered.splice(projectIdx, 2);
      }
      const colorIdx = filtered.indexOf("--color");
      let color: string | undefined;
      if (colorIdx >= 0) {
        color = filtered[colorIdx + 1];
        filtered.splice(colorIdx, 2);
      }
      const [command, ...args] = filtered;
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? `${JSON.stringify(value, null, 2)}\n` : `${text}\n`,
      });
      const fail = (stderr: string, exitCode = 1) => ({
        exitCode,
        stderr: `${stderr}\n`,
      });

      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: `${usage}\n` };
        case "list": {
          const labels = listLabels(db);
          return reply(
            { labels },
            labels.length === 0
              ? "No labels."
              : labels.map(formatLabel).join("\n"),
          );
        }
        case "create": {
          const name = args.join(" ").trim();
          if (!name) break;
          const { label, created } = createLabel(db, {
            name,
            color: color ?? null,
          });
          if (created) publish(bb, { type: "label-created", label });
          return reply(
            { label, created },
            created
              ? `Created ${formatLabel(label)}`
              : `Already exists ${formatLabel(label)}`,
          );
        }
        case "rename": {
          const [token, ...rest] = args;
          const newName = rest.join(" ").trim();
          if (!token || !newName) break;
          const existing = findLabelArg(token);
          if (!existing) return fail(`No label matching ${token}`);
          try {
            const label = renameLabel(db, {
              id: existing.id,
              name: newName,
            });
            publish(bb, { type: "label-renamed", label });
            return reply({ label }, `Renamed ${formatLabel(label)}`);
          } catch (error) {
            return fail(error instanceof Error ? error.message : String(error));
          }
        }
        case "delete": {
          const token = args[0];
          if (!token || args.length !== 1) break;
          const existing = findLabelArg(token);
          if (!existing) return fail(`No label matching ${token}`);
          const removed = deleteLabel(db, existing.id);
          if (removed) {
            publish(bb, { type: "label-deleted", labelId: existing.id });
          }
          return reply(
            { removed, id: existing.id },
            removed ? `Deleted ${existing.name}` : `Nothing deleted`,
          );
        }
        case "assign": {
          const [threadId, token] = args;
          if (!threadId || !token || args.length !== 2) break;
          let label = findLabelArg(token);
          if (!label) {
            const created = createLabel(db, { name: token });
            label = created.label;
            if (created.created) {
              publish(bb, { type: "label-created", label });
            }
          }
          const result = assignLabel(db, {
            threadId,
            labelId: label.id,
          });
          if (result.assigned) {
            publish(bb, { type: "assigned", threadId, label });
          }
          return reply(
            { label, assigned: result.assigned, threadId },
            result.assigned
              ? `Assigned ${label.name} → ${threadId}`
              : `${threadId} already has ${label.name}`,
          );
        }
        case "unassign": {
          const [threadId, token] = args;
          if (!threadId || !token || args.length !== 2) break;
          const label = findLabelArg(token);
          if (!label) return fail(`No label matching ${token}`);
          const { removed } = unassignLabel(db, {
            threadId,
            labelId: label.id,
          });
          if (removed) {
            publish(bb, {
              type: "unassigned",
              threadId,
              labelId: label.id,
            });
          }
          return reply(
            { removed, labelId: label.id, threadId },
            removed
              ? `Removed ${label.name} from ${threadId}`
              : `${threadId} did not have ${label.name}`,
          );
        }
        case "threads": {
          const token = args[0];
          if (!token || args.length !== 1) break;
          const label = findLabelArg(token);
          if (!label) return fail(`No label matching ${token}`);
          const threadIds = listThreadIdsByLabel(db, label.id);
          return reply(
            { label, threadIds },
            threadIds.length === 0
              ? `No threads for ${label.name}.`
              : threadIds.join("\n"),
          );
        }
        case "for-thread": {
          const threadId = args[0];
          if (!threadId || args.length !== 1) break;
          const labels = listLabelsForThread(db, threadId);
          return reply(
            { threadId, labels },
            labels.length === 0
              ? `No labels on ${threadId}.`
              : labels.map(formatLabel).join("\n"),
          );
        }
        case "mark-read": {
          const token = args[0];
          if (!token || args.length !== 1) break;
          const label = findLabelArg(token);
          if (!label) return fail(`No label matching ${token}`);
          const threadIds = listThreadIdsByLabel(db, label.id);
          let marked = 0;
          const failed: { threadId: string; error: string }[] = [];
          for (const threadId of threadIds) {
            try {
              await bb.sdk.threads.markRead({ threadId });
              marked += 1;
            } catch (error) {
              failed.push({
                threadId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          const value = {
            label,
            attempted: threadIds.length,
            marked,
            failed,
          };
          return reply(
            value,
            `Marked ${marked}/${threadIds.length} threads read for ${label.name}` +
              (failed.length > 0 ? ` (${failed.length} failed)` : ""),
          );
        }
        case "backfill-automations": {
          const label = await automationLabel();
          let offset = 0;
          const limit = 100;
          let scanned = 0;
          let assignedCount = 0;
          let alreadyLabeled = 0;
          for (;;) {
            const threads = await bb.sdk.threads.list({
              projectId,
              originPluginId: AUTOMATIONS_PLUGIN_ID,
              includeHidden: true,
              limit,
              offset,
            });
            if (threads.length === 0) break;
            for (const thread of threads) {
              scanned += 1;
              const has = listLabelsForThread(db, thread.id).some(
                (l) => l.id === label.id,
              );
              if (has) {
                alreadyLabeled += 1;
                continue;
              }
              if (dryRun) {
                assignedCount += 1;
                continue;
              }
              const result = assignLabel(db, {
                threadId: thread.id,
                labelId: label.id,
              });
              if (result.assigned) {
                assignedCount += 1;
                publish(bb, {
                  type: "assigned",
                  threadId: thread.id,
                  label,
                });
              } else {
                alreadyLabeled += 1;
              }
            }
            if (threads.length < limit) break;
            offset += threads.length;
          }
          const value = {
            label,
            scanned,
            assigned: assignedCount,
            alreadyLabeled,
            dryRun,
          };
          return reply(
            value,
            dryRun
              ? `Dry run: would assign ${assignedCount} of ${scanned} automation threads (${alreadyLabeled} already labeled)`
              : `Assigned ${assignedCount} of ${scanned} automation threads (${alreadyLabeled} already labeled)`,
          );
        }
      }
      return fail(usage);
    },
  });

  // Ensure settings schema is registered.
  void settings.get();

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
