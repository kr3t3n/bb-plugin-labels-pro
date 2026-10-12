import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

const asPlugin = (pluginId: string) => ({
  experimental_caller: { kind: "plugin" as const, pluginId },
});

async function load() {
  const { bb, harness } = createFakePluginHost({ pluginId: "labels-pro" });
  const delivered: unknown[] = [];
  harness.sdk.stub("plugins.callRpc", async (args: never) => {
    delivered.push(args);
    return null;
  });
  await plugin(bb);
  return { harness, delivered };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("listAssignments", () => {
  it("returns everything once, then nothing until a write", async () => {
    const { harness } = await load();
    const { label } = (await harness.callRpc("createLabel", { name: "Ops" })) as {
      label: { id: string };
    };
    await harness.callRpc("assignLabel", { threadId: "thr_1", labelId: label.id });

    const first = (await harness.callRpc("listAssignments", {})) as {
      revision: number;
      changed: boolean;
      assignments: { labelId: string; threadIds: string[] }[];
    };
    expect(first.changed).toBe(true);
    expect(first.assignments).toEqual([{ labelId: label.id, threadIds: ["thr_1"] }]);

    const again = await harness.callRpc("listAssignments", {
      sinceRevision: first.revision,
    });
    expect(again).toEqual({
      revision: first.revision,
      changed: false,
      labels: null,
      assignments: null,
    });

    await harness.callRpc("assignLabel", { threadId: "thr_2", labelId: label.id });
    const after = (await harness.callRpc("listAssignments", {
      sinceRevision: first.revision,
    })) as { changed: boolean };
    expect(after.changed).toBe(true);
  });
});

describe("subscribeChanges", () => {
  it("accepts plugins only", async () => {
    const { harness } = await load();
    await expect(
      harness.callRpc("subscribeChanges", { method: "labelsChanged" }),
    ).rejects.toThrow(/for plugins/);
  });

  it("sends a burst of writes as one call with each thread's current labels", async () => {
    vi.useFakeTimers();
    const { harness, delivered } = await load();
    await harness.callRpc(
      "subscribeChanges",
      { method: "labelsChanged" },
      asPlugin("sidebar-pro"),
    );
    const { label: a } = (await harness.callRpc("createLabel", { name: "A" })) as {
      label: { id: string };
    };
    await vi.advanceTimersByTimeAsync(300);
    delivered.length = 0;

    await harness.callRpc("assignLabel", { threadId: "thr_1", labelId: a.id });
    await harness.callRpc("assignLabel", { threadId: "thr_2", labelId: a.id });
    await harness.callRpc("unassignLabel", { threadId: "thr_2", labelId: a.id });
    expect(delivered).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(300);

    expect(delivered).toHaveLength(1);
    const call = delivered[0] as {
      pluginId: string;
      method: string;
      input: { threads: Record<string, string[]>; labelsChanged: boolean };
    };
    expect(call.pluginId).toBe("sidebar-pro");
    expect(call.method).toBe("labelsChanged");
    expect(call.input.threads).toEqual({ thr_1: [a.id], thr_2: [] });
    expect(call.input.labelsChanged).toBe(false);
  });

  it("asks subscribers to reload when a label itself changes", async () => {
    vi.useFakeTimers();
    const { harness, delivered } = await load();
    await harness.callRpc(
      "subscribeChanges",
      { method: "labelsChanged" },
      asPlugin("sidebar-pro"),
    );
    await harness.callRpc("createLabel", { name: "New" });
    await vi.advanceTimersByTimeAsync(300);
    expect(delivered).toHaveLength(1);
    expect((delivered[0] as { input: { labelsChanged: boolean } }).input.labelsChanged).toBe(true);
  });

  it("stops after unsubscribe", async () => {
    vi.useFakeTimers();
    const { harness, delivered } = await load();
    await harness.callRpc("subscribeChanges", { method: "m" }, asPlugin("sidebar-pro"));
    await harness.callRpc("unsubscribeChanges", {}, asPlugin("sidebar-pro"));
    await harness.callRpc("createLabel", { name: "Quiet" });
    await vi.advanceTimersByTimeAsync(300);
    expect(delivered).toHaveLength(0);
  });
});
