// Stable RPC surface for Labels Pro. Sibling plugins (Sidebar Pro,
// Notifications Pro) should depend on these method names and schemas.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const labelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    color: z.string().nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .strict();

export type LabelDto = z.infer<typeof labelSchema>;

export const LABEL_REALTIME_CHANNEL = "labels";

export const rpcContract = defineRpcContract({
  listLabels: {
    input: z.null(),
    output: z.object({ labels: z.array(labelSchema) }).strict(),
  },
  createLabel: {
    input: z
      .object({
        name: z.string().trim().min(1).max(80),
        color: z.string().trim().min(1).max(32).nullable().optional(),
      })
      .strict(),
    output: z
      .object({
        label: labelSchema,
        created: z.boolean(),
      })
      .strict(),
  },
  renameLabel: {
    input: z
      .object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(80),
        color: z.string().trim().min(1).max(32).nullable().optional(),
      })
      .strict(),
    output: z.object({ label: labelSchema }).strict(),
  },
  deleteLabel: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.object({ removed: z.boolean() }).strict(),
  },
  getThreadLabels: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ labels: z.array(labelSchema) }).strict(),
  },
  assignLabel: {
    input: z
      .object({
        threadId: z.string().min(1),
        labelId: z.string().min(1).optional(),
        labelName: z.string().trim().min(1).max(80).optional(),
      })
      .strict(),
    output: z
      .object({
        label: labelSchema,
        assigned: z.boolean(),
      })
      .strict(),
  },
  unassignLabel: {
    input: z
      .object({
        threadId: z.string().min(1),
        labelId: z.string().min(1).optional(),
        labelName: z.string().trim().min(1).max(80).optional(),
      })
      .strict(),
    output: z
      .object({
        removed: z.boolean(),
        labelId: z.string().nullable(),
      })
      .strict(),
  },
  setThreadLabels: {
    input: z
      .object({
        threadId: z.string().min(1),
        labelIds: z.array(z.string().min(1)).max(50),
      })
      .strict(),
    output: z
      .object({
        labels: z.array(labelSchema),
        added: z.array(z.string()),
        removed: z.array(z.string()),
      })
      .strict(),
  },
  listThreadsByLabel: {
    input: z
      .object({
        labelId: z.string().min(1).optional(),
        labelName: z.string().trim().min(1).max(80).optional(),
      })
      .strict(),
    output: z
      .object({
        label: labelSchema.nullable(),
        threadIds: z.array(z.string()),
      })
      .strict(),
  },
  markAllReadByLabel: {
    input: z
      .object({
        labelId: z.string().min(1).optional(),
        labelName: z.string().trim().min(1).max(80).optional(),
      })
      .strict(),
    output: z
      .object({
        label: labelSchema.nullable(),
        attempted: z.number().int(),
        marked: z.number().int(),
        failed: z.array(
          z
            .object({
              threadId: z.string(),
              error: z.string(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  backfillAutomations: {
    input: z
      .object({
        dryRun: z.boolean().default(false),
        projectId: z.string().min(1).optional(),
      })
      .strict(),
    output: z
      .object({
        label: labelSchema,
        scanned: z.number().int(),
        assigned: z.number().int(),
        alreadyLabeled: z.number().int(),
        dryRun: z.boolean(),
      })
      .strict(),
  },
  backfillTaskProjects: {
    input: z
      .object({
        dryRun: z.boolean().default(false),
      })
      .strict(),
    output: z
      .object({
        scanned: z.number().int(),
        assigned: z.number().int(),
        alreadyLabeled: z.number().int(),
        skipped: z.number().int(),
        dryRun: z.boolean(),
        byProject: z.array(
          z
            .object({
              projectName: z.string(),
              assigned: z.number().int(),
              alreadyLabeled: z.number().int(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
});

export type LabelsRpcContract = typeof rpcContract;
