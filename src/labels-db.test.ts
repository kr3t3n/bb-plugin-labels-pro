import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  LABEL_MIGRATIONS,
  assignLabel,
  createLabel,
  deleteLabel,
  ensureLabelByName,
  getRevision,
  listAllAssignments,
  listLabelsForThread,
  listSubscribers,
  removeSubscriber,
  upsertSubscriber,
  listThreadIdsByLabel,
  renameLabel,
  setThreadLabels,
  slugifyLabelName,
  unassignLabel,
  type LabelsDb,
} from "./labels-db";

function openDb(): LabelsDb & { close: () => void } {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const sql of LABEL_MIGRATIONS) db.exec(sql);
  return db as unknown as LabelsDb & { close: () => void };
}

describe("slugifyLabelName", () => {
  it("normalizes names", () => {
    expect(slugifyLabelName("  Automation Ops ")).toBe("automation-ops");
    expect(slugifyLabelName("!!!")).toBe("label");
  });
});

describe("labels db", () => {
  let db: LabelsDb & { close: () => void };

  afterEach(() => {
    db?.close();
  });

  it("creates labels and is idempotent by name", () => {
    db = openDb();
    const first = createLabel(db, { name: "automation" });
    expect(first.created).toBe(true);
    const second = createLabel(db, { name: "Automation" });
    expect(second.created).toBe(false);
    expect(second.label.id).toBe(first.label.id);
  });

  it("assign/unassign is idempotent and supports multi-label threads", () => {
    db = openDb();
    const a = createLabel(db, { name: "a" }).label;
    const b = createLabel(db, { name: "b" }).label;
    const threadId = "thr_1";

    expect(assignLabel(db, { threadId, labelId: a.id }).assigned).toBe(true);
    expect(assignLabel(db, { threadId, labelId: a.id }).assigned).toBe(false);
    expect(assignLabel(db, { threadId, labelId: b.id }).assigned).toBe(true);

    const labels = listLabelsForThread(db, threadId).map((l) => l.name);
    expect(labels).toEqual(["a", "b"]);
    expect(listThreadIdsByLabel(db, a.id)).toEqual([threadId]);

    expect(unassignLabel(db, { threadId, labelId: a.id }).removed).toBe(true);
    expect(unassignLabel(db, { threadId, labelId: a.id }).removed).toBe(false);
    expect(listLabelsForThread(db, threadId).map((l) => l.name)).toEqual(["b"]);
  });

  it("setThreadLabels replaces the set", () => {
    db = openDb();
    const a = createLabel(db, { name: "a" }).label;
    const b = createLabel(db, { name: "b" }).label;
    const c = createLabel(db, { name: "c" }).label;
    const threadId = "thr_2";
    assignLabel(db, { threadId, labelId: a.id });
    assignLabel(db, { threadId, labelId: b.id });

    const result = setThreadLabels(db, {
      threadId,
      labelIds: [b.id, c.id],
    });
    expect(result.added).toEqual([c.id]);
    expect(result.removed).toEqual([a.id]);
    expect(result.labels.map((l) => l.name)).toEqual(["b", "c"]);
  });

  it("rename and delete cascade links", () => {
    db = openDb();
    const label = createLabel(db, { name: "old" }).label;
    assignLabel(db, { threadId: "thr_3", labelId: label.id });
    const renamed = renameLabel(db, { id: label.id, name: "new" });
    expect(renamed.name).toBe("new");
    expect(renamed.slug).toBe("new");
    expect(deleteLabel(db, label.id)).toBe(true);
    expect(listLabelsForThread(db, "thr_3")).toEqual([]);
  });

  it("ensureLabelByName creates once", () => {
    db = openDb();
    const first = ensureLabelByName(db, "automation");
    const second = ensureLabelByName(db, "automation");
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.label.id).toBe(second.label.id);
  });
});

describe("revision and bulk reads", () => {
  let db: LabelsDb & { close: () => void };

  afterEach(() => {
    db?.close();
  });

  it("raises the revision on every label and assignment write", () => {
    db = openDb();
    const seen = [getRevision(db)];
    const { label: a } = createLabel(db, { name: "Alpha" });
    seen.push(getRevision(db));
    assignLabel(db, { threadId: "thr_1", labelId: a.id });
    seen.push(getRevision(db));
    renameLabel(db, { id: a.id, name: "Alpha 2" });
    seen.push(getRevision(db));
    unassignLabel(db, { threadId: "thr_1", labelId: a.id });
    seen.push(getRevision(db));
    assignLabel(db, { threadId: "thr_2", labelId: a.id });
    const beforeDelete = getRevision(db);
    deleteLabel(db, a.id);
    seen.push(getRevision(db));
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1]!);
    }
    expect(getRevision(db)).toBeGreaterThan(beforeDelete);
  });

  it("keeps the revision when nothing is written", () => {
    db = openDb();
    const { label } = createLabel(db, { name: "Alpha" });
    assignLabel(db, { threadId: "thr_1", labelId: label.id });
    const revision = getRevision(db);
    listAllAssignments(db);
    listLabelsForThread(db, "thr_1");
    expect(getRevision(db)).toBe(revision);
  });

  it("lists every assignment grouped by label in name order", () => {
    db = openDb();
    const { label: zed } = createLabel(db, { name: "Zed" });
    const { label: alpha } = createLabel(db, { name: "alpha" });
    assignLabel(db, { threadId: "thr_1", labelId: zed.id });
    assignLabel(db, { threadId: "thr_2", labelId: alpha.id });
    assignLabel(db, { threadId: "thr_1", labelId: alpha.id });
    const groups = listAllAssignments(db);
    expect(groups.map((group) => group.labelId)).toEqual([alpha.id, zed.id]);
    expect([...groups[0]!.threadIds].sort()).toEqual(["thr_1", "thr_2"]);
    expect(groups[1]!.threadIds).toEqual(["thr_1"]);
  });

  it("stores one subscription per plugin", () => {
    db = openDb();
    upsertSubscriber(db, { pluginId: "sidebar-pro", method: "old" });
    upsertSubscriber(db, { pluginId: "sidebar-pro", method: "labelsChanged" });
    upsertSubscriber(db, { pluginId: "notifications-pro", method: "onLabels" });
    expect(listSubscribers(db)).toEqual([
      { pluginId: "notifications-pro", method: "onLabels" },
      { pluginId: "sidebar-pro", method: "labelsChanged" },
    ]);
    expect(removeSubscriber(db, "sidebar-pro")).toBe(true);
    expect(removeSubscriber(db, "sidebar-pro")).toBe(false);
  });
});
