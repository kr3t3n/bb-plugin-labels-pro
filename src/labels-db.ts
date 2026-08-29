// SQLite helpers for Labels Pro. Pure against a better-sqlite3-compatible db
// so unit tests can drive the same code path as the plugin server.
import { randomUUID } from "node:crypto";

export type LabelsDb = {
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number };
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };
  exec?: (sql: string) => void;
};

export type LabelRow = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ThreadLabelLink = {
  threadId: string;
  labelId: string;
  assignedAt: number;
};

type LabelStmt = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  created_at: number;
  updated_at: number;
};

export const LABEL_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    color TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS labels_name_idx ON labels (name COLLATE NOCASE)`,
  `CREATE TABLE IF NOT EXISTS thread_labels (
    thread_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    PRIMARY KEY (thread_id, label_id),
    FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS thread_labels_label_idx
    ON thread_labels (label_id, assigned_at DESC)`,
  `CREATE INDEX IF NOT EXISTS thread_labels_thread_idx
    ON thread_labels (thread_id)`,
];

/** Normalize a display name into a stable slug (lowercase, hyphenated). */
export function slugifyLabelName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "label";
}

function fromStmt(row: LabelStmt): LabelRow {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listLabels(db: LabelsDb): LabelRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM labels ORDER BY name COLLATE NOCASE ASC, created_at ASC`,
    )
    .all() as LabelStmt[];
  return rows.map(fromStmt);
}

export function getLabelById(db: LabelsDb, id: string): LabelRow | null {
  const row = db.prepare(`SELECT * FROM labels WHERE id = ?`).get(id) as
    | LabelStmt
    | undefined;
  return row ? fromStmt(row) : null;
}

export function getLabelBySlug(db: LabelsDb, slug: string): LabelRow | null {
  const row = db
    .prepare(`SELECT * FROM labels WHERE slug = ?`)
    .get(slug) as LabelStmt | undefined;
  return row ? fromStmt(row) : null;
}

export function getLabelByName(
  db: LabelsDb,
  name: string,
): LabelRow | null {
  const row = db
    .prepare(`SELECT * FROM labels WHERE name = ? COLLATE NOCASE`)
    .get(name.trim()) as LabelStmt | undefined;
  return row ? fromStmt(row) : null;
}

export function createLabel(
  db: LabelsDb,
  input: { name: string; color?: string | null; id?: string },
): { label: LabelRow; created: boolean } {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("Label name is required");
  }
  const existing = getLabelByName(db, name);
  if (existing) {
    return { label: existing, created: false };
  }
  let slug = slugifyLabelName(name);
  // Keep slug unique when names collide only after normalization.
  if (getLabelBySlug(db, slug)) {
    let n = 2;
    while (getLabelBySlug(db, `${slug}-${n}`)) n += 1;
    slug = `${slug}-${n}`;
  }
  const now = Date.now();
  const label: LabelRow = {
    id: input.id ?? randomUUID(),
    name,
    slug,
    color: input.color ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO labels (id, name, slug, color, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(label.id, label.name, label.slug, label.color, label.createdAt, label.updatedAt);
  return { label, created: true };
}

export function renameLabel(
  db: LabelsDb,
  input: { id: string; name: string; color?: string | null },
): LabelRow {
  const existing = getLabelById(db, input.id);
  if (!existing) throw new Error(`No label with id ${input.id}`);
  const name = input.name.trim();
  if (name.length === 0) throw new Error("Label name is required");
  const clash = getLabelByName(db, name);
  if (clash && clash.id !== input.id) {
    throw new Error(`Label "${name}" already exists`);
  }
  let slug = slugifyLabelName(name);
  const slugOwner = getLabelBySlug(db, slug);
  if (slugOwner && slugOwner.id !== input.id) {
    let n = 2;
    while (true) {
      const candidate = `${slug}-${n}`;
      const owner = getLabelBySlug(db, candidate);
      if (!owner || owner.id === input.id) {
        slug = candidate;
        break;
      }
      n += 1;
    }
  }
  const color =
    input.color === undefined ? existing.color : input.color;
  const updatedAt = Date.now();
  db.prepare(
    `UPDATE labels SET name = ?, slug = ?, color = ?, updated_at = ? WHERE id = ?`,
  ).run(name, slug, color, updatedAt, input.id);
  return {
    id: input.id,
    name,
    slug,
    color,
    createdAt: existing.createdAt,
    updatedAt,
  };
}

export function deleteLabel(db: LabelsDb, id: string): boolean {
  // Explicitly clear links so callers without FK enforcement stay consistent.
  db.prepare(`DELETE FROM thread_labels WHERE label_id = ?`).run(id);
  const result = db.prepare(`DELETE FROM labels WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function listLabelsForThread(
  db: LabelsDb,
  threadId: string,
): LabelRow[] {
  const rows = db
    .prepare(
      `SELECT l.* FROM labels l
       INNER JOIN thread_labels tl ON tl.label_id = l.id
       WHERE tl.thread_id = ?
       ORDER BY l.name COLLATE NOCASE ASC`,
    )
    .all(threadId) as LabelStmt[];
  return rows.map(fromStmt);
}

export function listThreadIdsByLabel(
  db: LabelsDb,
  labelId: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT thread_id FROM thread_labels
       WHERE label_id = ?
       ORDER BY assigned_at DESC`,
    )
    .all(labelId) as { thread_id: string }[];
  return rows.map((row) => row.thread_id);
}

export function assignLabel(
  db: LabelsDb,
  input: { threadId: string; labelId: string },
): { assigned: boolean; link: ThreadLabelLink } {
  if (!getLabelById(db, input.labelId)) {
    throw new Error(`No label with id ${input.labelId}`);
  }
  const existing = db
    .prepare(
      `SELECT thread_id, label_id, assigned_at FROM thread_labels
       WHERE thread_id = ? AND label_id = ?`,
    )
    .get(input.threadId, input.labelId) as
    | { thread_id: string; label_id: string; assigned_at: number }
    | undefined;
  if (existing) {
    return {
      assigned: false,
      link: {
        threadId: existing.thread_id,
        labelId: existing.label_id,
        assignedAt: existing.assigned_at,
      },
    };
  }
  const assignedAt = Date.now();
  db.prepare(
    `INSERT INTO thread_labels (thread_id, label_id, assigned_at)
     VALUES (?, ?, ?)`,
  ).run(input.threadId, input.labelId, assignedAt);
  return {
    assigned: true,
    link: {
      threadId: input.threadId,
      labelId: input.labelId,
      assignedAt,
    },
  };
}

export function unassignLabel(
  db: LabelsDb,
  input: { threadId: string; labelId: string },
): { removed: boolean } {
  const result = db
    .prepare(
      `DELETE FROM thread_labels WHERE thread_id = ? AND label_id = ?`,
    )
    .run(input.threadId, input.labelId);
  return { removed: result.changes > 0 };
}

/** Replace a thread's label set. Idempotent relative to the desired ids. */
export function setThreadLabels(
  db: LabelsDb,
  input: { threadId: string; labelIds: string[] },
): { added: string[]; removed: string[]; labels: LabelRow[] } {
  const desired = [...new Set(input.labelIds)];
  for (const labelId of desired) {
    if (!getLabelById(db, labelId)) {
      throw new Error(`No label with id ${labelId}`);
    }
  }
  const current = listLabelsForThread(db, input.threadId).map((l) => l.id);
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);
  const added: string[] = [];
  const removed: string[] = [];
  for (const labelId of desired) {
    if (!currentSet.has(labelId)) {
      assignLabel(db, { threadId: input.threadId, labelId });
      added.push(labelId);
    }
  }
  for (const labelId of current) {
    if (!desiredSet.has(labelId)) {
      unassignLabel(db, { threadId: input.threadId, labelId });
      removed.push(labelId);
    }
  }
  return {
    added,
    removed,
    labels: listLabelsForThread(db, input.threadId),
  };
}

/** Ensure a label with the given name exists; create if missing. */
export function ensureLabelByName(
  db: LabelsDb,
  name: string,
): { label: LabelRow; created: boolean } {
  return createLabel(db, { name });
}
