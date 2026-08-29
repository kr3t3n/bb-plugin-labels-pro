// bb-plugin-labels-pro — frontend: labels manager + settings note.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { LabelDto, rpcContract } from "./server";
import { LABEL_REALTIME_CHANNEL } from "./src/rpc-contract";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

function useLabels() {
  const rpc = useRpc<typeof rpcContract>();
  const [labels, setLabels] = useState<LabelDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);
  const refetch = useCallback(() => {
    rpc.call("listLabels").then((result) => {
      setLabels(result.labels);
      setError(null);
    }, report);
  }, [rpc, report]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime(LABEL_REALTIME_CHANNEL, refetch);
  return { rpc, labels, error, report, refetch };
}

function LabelsPage() {
  const { rpc, labels, error, report, refetch } = useLabels();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const settings = useSettings();
  const autoTag =
    (settings.values?.autoTagAutomations as boolean | undefined) ?? true;
  const automationName =
    (settings.values?.automationLabelName as string | undefined) ??
    "automation";
  const autoTagTasks =
    (settings.values?.autoTagTaskProjects as boolean | undefined) ?? true;

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = name.trim();
    if (next === "" || pending) return;
    setPending(true);
    try {
      await rpc.call("createLabel", { name: next });
      setName("");
      refetch();
    } catch (cause) {
      report(cause);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
        <p className="text-sm text-muted-foreground">
          Agents manage labels with <code>bb labels</code>. Sibling plugins
          read the same store over RPC — see{" "}
          <code>docs/rpc-contract.md</code>.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Automation auto-tag:{" "}
          {autoTag ? `on → "${automationName}"` : "off"}. Task project
          auto-tag: {autoTagTasks ? "on → project name" : "off"} (Settings →
          Labels Pro).
        </p>
        <form onSubmit={add} className="mt-4 flex items-center gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New label name"
            aria-label="New label"
          />
          <Button type="submit" disabled={pending || name.trim() === ""}>
            <Icon name="Plus" className="size-4" />
            Add
          </Button>
        </form>
        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4">
          {labels === null ? (
            <div
              role="status"
              className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
            >
              Loading labels…
            </div>
          ) : labels.length === 0 ? (
            <div
              role="status"
              className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
            >
              No labels yet. Add one above, or run{" "}
              <code>bb labels create automation</code>.
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {labels.map((label) => (
                <li
                  key={label.id}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full bg-muted-foreground/40"
                    style={
                      label.color
                        ? { backgroundColor: label.color }
                        : undefined
                    }
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {label.name}
                  </span>
                  <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                    {label.slug}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    aria-label={`Delete "${label.name}"`}
                    onClick={() => {
                      rpc
                        .call("deleteLabel", { id: label.id })
                        .then(refetch, report);
                    }}
                  >
                    <Icon name="Trash2" className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsHint() {
  return (
    <p className="text-sm text-muted-foreground">
      Use the toggles above for automation and task-project auto-tag. CLI:{" "}
      <code>bb labels backfill-automations</code> and{" "}
      <code>bb labels backfill-task-projects</code>. Task threads get a label
      named after their Tasks project (for example Labels Pro).
    </p>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "labels",
    title: "Labels",
    icon: "./assets/icon.svg",
    path: "labels",
    component: LabelsPage,
  });

  app.slots.settingsSection({
    id: "labels-help",
    title: "CLI & integrations",
    description: "Agent and sibling-plugin notes for Labels Pro.",
    component: SettingsHint,
  });
});
