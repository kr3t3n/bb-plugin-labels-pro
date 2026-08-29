// Minimal Tasks plugin bridge for Labels Pro project-name auto-tag.
import { z } from "zod";

export const TASKS_PLUGIN_ID = "tasks";

export interface TasksCallApi {
  sdk: {
    plugins: {
      callRpc<TOutput>(args: {
        pluginId: string;
        method: string;
        input?: unknown;
        outputSchema: z.ZodType<TOutput>;
      }): Promise<TOutput>;
    };
    threads: {
      get(args: { threadId: string }): Promise<{
        id: string;
        title?: string | null;
      }>;
    };
  };
}

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
});

const taskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string(),
  title: z.string(),
  threadCount: z.number().int().nonnegative().optional(),
});

const taskThreadSchema = z.object({
  threadId: z.string(),
  attachedAt: z.string().default(""),
});

const listProjectsOut = z.object({ projects: z.array(projectSchema) });
const getTaskOut = z.object({ task: taskSchema.nullable() });
const getTaskByKeyOut = z.object({ task: taskSchema.nullable() });
const listTasksOut = z.object({
  tasks: z.array(taskSchema),
  nextCursor: z.string().nullable().optional(),
});
const listTaskThreadsOut = z.object({
  taskThreads: z.array(taskThreadSchema),
});

const TASK_KEY_IN_TITLE = /^([A-Za-z][A-Za-z0-9]*-\d+)\b/;
const PAGE_LIMIT = 200;
const FANOUT = 8;

export type TaskProjectHit = {
  threadId: string;
  taskKey: string;
  taskId: string;
  projectId: string;
  projectName: string;
};

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export async function listTaskProjects(
  bb: TasksCallApi,
): Promise<Array<{ id: string; name: string; prefix: string }>> {
  const { projects } = await bb.sdk.plugins.callRpc({
    pluginId: TASKS_PLUGIN_ID,
    method: "listProjects",
    input: {},
    outputSchema: listProjectsOut,
  });
  return projects;
}

async function listAllTasks(
  bb: TasksCallApi,
): Promise<Array<z.infer<typeof taskSchema>>> {
  const tasks: Array<z.infer<typeof taskSchema>> = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bb.sdk.plugins.callRpc({
      pluginId: TASKS_PLUGIN_ID,
      method: "listTasks",
      input: {
        limit: PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      },
      outputSchema: listTasksOut,
    });
    tasks.push(...page.tasks);
    if (!page.nextCursor || page.tasks.length === 0) break;
    cursor = page.nextCursor;
  }
  return tasks;
}

async function listThreadsForTask(
  bb: TasksCallApi,
  taskId: string,
): Promise<Array<z.infer<typeof taskThreadSchema>>> {
  const { taskThreads } = await bb.sdk.plugins.callRpc({
    pluginId: TASKS_PLUGIN_ID,
    method: "listTaskThreads",
    input: { taskId },
    outputSchema: listTaskThreadsOut,
  });
  return taskThreads;
}

/**
 * Resolve the Tasks project name for a bb thread that is attached to a task.
 * Prefers the task key in the thread title (dispatch format `SIDE-1 · …`).
 */
export async function resolveTaskProjectForThread(
  bb: TasksCallApi,
  threadId: string,
): Promise<TaskProjectHit | null> {
  const normalized = threadId.trim();
  if (!normalized.startsWith("thr_")) return null;

  let projects: Array<{ id: string; name: string; prefix: string }> = [];
  try {
    projects = await listTaskProjects(bb);
  } catch {
    return null;
  }
  const projectById = new Map(projects.map((p) => [p.id, p]));

  try {
    const thread = await bb.sdk.threads.get({ threadId: normalized });
    const title = (thread.title ?? "").trim();
    const keyMatch = TASK_KEY_IN_TITLE.exec(title);
    if (keyMatch?.[1]) {
      const { task } = await bb.sdk.plugins.callRpc({
        pluginId: TASKS_PLUGIN_ID,
        method: "getTaskByKey",
        input: { taskKey: keyMatch[1] },
        outputSchema: getTaskByKeyOut,
      });
      if (task) {
        const threads = await listThreadsForTask(bb, task.id);
        if (threads.some((row) => row.threadId === normalized)) {
          const project = projectById.get(task.projectId);
          if (project) {
            return {
              threadId: normalized,
              taskKey: task.key,
              taskId: task.id,
              projectId: project.id,
              projectName: project.name,
            };
          }
        }
      }
    }
  } catch {
    // Fall through to a full scan.
  }

  const tasks = await listAllTasks(bb).catch(() => []);
  const matches = await mapPool(tasks, FANOUT, async (task) => {
    const threads = await listThreadsForTask(bb, task.id).catch(() => []);
    const hit = threads.find((row) => row.threadId === normalized);
    if (!hit) return null;
    const project = projectById.get(task.projectId);
    if (!project) return null;
    return {
      threadId: normalized,
      taskKey: task.key,
      taskId: task.id,
      projectId: project.id,
      projectName: project.name,
      attachedAt: hit.attachedAt,
    };
  });

  const found = matches
    .filter(
      (
        row,
      ): row is TaskProjectHit & { attachedAt: string } => row != null,
    )
    .sort((a, b) => b.attachedAt.localeCompare(a.attachedAt));
  const best = found[0];
  if (!best) return null;
  return {
    threadId: best.threadId,
    taskKey: best.taskKey,
    taskId: best.taskId,
    projectId: best.projectId,
    projectName: best.projectName,
  };
}

/** Every attached task-thread with its Tasks project name. */
export async function listAllTaskProjectAttachments(
  bb: TasksCallApi,
): Promise<TaskProjectHit[]> {
  const projects = await listTaskProjects(bb);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const tasks = await listAllTasks(bb);
  const nested = await mapPool(tasks, FANOUT, async (task) => {
    const project = projectById.get(task.projectId);
    if (!project) return [] as TaskProjectHit[];
    if (task.threadCount === 0) return [];
    const threads = await listThreadsForTask(bb, task.id).catch(() => []);
    return threads.map((row) => ({
      threadId: row.threadId,
      taskKey: task.key,
      taskId: task.id,
      projectId: project.id,
      projectName: project.name,
    }));
  });
  return nested.flat();
}
