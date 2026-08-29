// Thread header control: show this thread's Labels Pro labels and edit them
// in a popover. Mounted once per split pane with that pane's threadId — all
// state lives in this component (no module singleton).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type { LabelDto, rpcContract } from "../server";
import { LABEL_REALTIME_CHANNEL } from "./rpc-contract";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

const MAX_CHIP_DOTS = 3;

export function ThreadLabelsChip({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const [threadLabels, setThreadLabels] = useState<LabelDto[] | null>(null);
  const [allLabels, setAllLabels] = useState<LabelDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);

  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  const refetch = useCallback(() => {
    void Promise.all([
      rpc.call("getThreadLabels", { threadId }),
      rpc.call("listLabels"),
    ]).then(([threadResult, listResult]) => {
      setThreadLabels(threadResult.labels);
      setAllLabels(listResult.labels);
      setError(null);
    }, report);
  }, [rpc, threadId, report]);

  useEffect(() => {
    setThreadLabels(null);
    setAllLabels(null);
    setOpen(false);
    setCreateName("");
    setError(null);
    refetch();
  }, [threadId, refetch]);

  useRealtime(LABEL_REALTIME_CHANNEL, refetch);

  const assignedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const label of threadLabels ?? []) ids.add(label.id);
    return ids;
  }, [threadLabels]);

  const toggle = async (label: LabelDto) => {
    if (pendingId !== null) return;
    setPendingId(label.id);
    try {
      if (assignedIds.has(label.id)) {
        await rpc.call("unassignLabel", { threadId, labelId: label.id });
      } else {
        await rpc.call("assignLabel", { threadId, labelId: label.id });
      }
      refetch();
    } catch (cause) {
      report(cause);
    } finally {
      setPendingId(null);
    }
  };

  const createAndAssign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = createName.trim();
    if (name === "" || creating) return;
    setCreating(true);
    try {
      // assignLabel with labelName ensures the label exists, then links it.
      await rpc.call("assignLabel", { threadId, labelName: name });
      setCreateName("");
      refetch();
    } catch (cause) {
      report(cause);
    } finally {
      setCreating(false);
    }
  };

  const count = threadLabels?.length ?? 0;
  const chipLabel =
    count === 0
      ? "Labels"
      : count === 1
        ? (threadLabels?.[0]?.name ?? "1 label")
        : `${count} labels`;

  return (
    <span className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          count === 0
            ? "Edit thread labels"
            : `Edit thread labels (${chipLabel})`
        }
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-7 max-w-[11rem] items-center gap-1.5 rounded-full border border-border px-2 text-2xs text-muted-foreground",
          "hover:bg-accent hover:text-foreground",
          open && "bg-accent text-foreground",
        )}
      >
        <LabelDotCluster labels={threadLabels ?? []} />
        {isCompactViewport ? null : (
          <span className="truncate">{chipLabel}</span>
        )}
      </button>
      {open ? (
        <>
          <span
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="Thread labels"
            className="absolute right-0 top-9 z-50 w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
          >
            <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
              <span className="text-xs font-semibold">Labels</span>
              <span className="ml-auto text-2xs text-muted-foreground">
                {count}
              </span>
            </div>
            {error === null ? null : (
              <p role="alert" className="px-3 pb-1 text-2xs text-destructive">
                {error}
              </p>
            )}
            <ul className="flex max-h-56 flex-col gap-px overflow-y-auto p-1.5 pt-0.5">
              {allLabels === null ? (
                <li className="px-2 py-2 text-2xs text-muted-foreground">
                  Loading…
                </li>
              ) : allLabels.length === 0 ? (
                <li className="px-2 py-2 text-2xs text-muted-foreground">
                  No labels yet. Create one below.
                </li>
              ) : (
                allLabels.map((label) => {
                  const checked = assignedIds.has(label.id);
                  const busy = pendingId === label.id;
                  return (
                    <li key={label.id} className="list-none">
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={checked}
                        disabled={busy}
                        onClick={() => {
                          void toggle(label);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                          "hover:bg-accent disabled:opacity-60",
                          checked && "text-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-sm border border-input",
                            checked &&
                              "border-foreground bg-foreground text-background",
                          )}
                          aria-hidden
                        >
                          {checked ? (
                            <Icon name="Check" className="size-3" />
                          ) : null}
                        </span>
                        <span
                          className="size-2 shrink-0 rounded-full bg-muted-foreground/40"
                          style={
                            label.color
                              ? { backgroundColor: label.color }
                              : undefined
                          }
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {label.name}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
            <form
              onSubmit={createAndAssign}
              className="flex items-center gap-1.5 border-t border-border p-2"
            >
              <Input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="New label…"
                aria-label="Create and assign label"
                className="h-7 text-xs"
              />
              <button
                type="submit"
                disabled={creating || createName.trim() === ""}
                aria-label="Create and assign label"
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md border border-border",
                  "hover:bg-accent disabled:opacity-50",
                )}
              >
                <Icon name="Plus" className="size-3.5" />
              </button>
            </form>
          </div>
        </>
      ) : null}
    </span>
  );
}

function LabelDotCluster({ labels }: { labels: readonly LabelDto[] }) {
  if (labels.length === 0) {
    return (
      <span
        className="size-2.5 shrink-0 rounded-full border border-dashed border-muted-foreground/50"
        aria-hidden
      />
    );
  }
  const shown = labels.slice(0, MAX_CHIP_DOTS);
  return (
    <span className="flex shrink-0 items-center" aria-hidden>
      {shown.map((label, index) => (
        <span
          key={label.id}
          className={cn(
            "size-2.5 rounded-full border border-popover bg-muted-foreground/50",
            index > 0 && "-ml-1",
          )}
          style={label.color ? { backgroundColor: label.color } : undefined}
        />
      ))}
      {labels.length > MAX_CHIP_DOTS ? (
        <span className="-ml-1 size-2.5 rounded-full border border-popover bg-muted-foreground/30" />
      ) : null}
    </span>
  );
}
