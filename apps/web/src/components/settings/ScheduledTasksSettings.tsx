/**
 * Scheduled tasks settings — prompts an environment sends on its own clock.
 *
 * The editor is deliberately one form per task rather than a wizard: a task is
 * four decisions (what to say, where to say it, who to say it to, when), and
 * splitting four fields across steps would hide the shape of the thing being
 * built.
 *
 * Times are the *server's* wall clock, and the panel says so: a phone in
 * another timezone must not read a different hour than the machine that will
 * actually run the prompt.
 *
 * @module ScheduledTasksSettings
 */
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import {
  nextScheduledRunAt,
  type ScheduledTask,
  type ScheduledTaskDraft,
  type ScheduledTaskTarget,
} from "@t3tools/contracts/scheduledTasks";
import { PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { deriveProviderInstanceEntries } from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useScheduledTasks } from "../../state/scheduledTasks";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface DraftState {
  readonly id?: ScheduledTask["id"];
  name: string;
  prompt: string;
  projectId: string;
  timeOfDay: string;
  daysOfWeek: ReadonlyArray<number>;
  enabled: boolean;
  targets: ReadonlyArray<ScheduledTaskTarget>;
}

const emptyDraft = (projectId: string): DraftState => ({
  name: "",
  prompt: "",
  projectId,
  timeOfDay: "05:00",
  daysOfWeek: [],
  enabled: true,
  targets: [],
});

const draftFromTask = (task: ScheduledTask): DraftState => ({
  id: task.id,
  name: task.name,
  prompt: task.prompt,
  projectId: task.projectId,
  timeOfDay: task.schedule.timeOfDay,
  daysOfWeek: task.schedule.daysOfWeek,
  enabled: task.enabled,
  targets: task.targets,
});

function describeSchedule(task: ScheduledTask): string {
  const days =
    task.schedule.daysOfWeek.length === 0
      ? "every day"
      : task.schedule.daysOfWeek
          .slice()
          .sort((left, right) => left - right)
          .map((day) => DAY_LABELS[day])
          .join(", ");
  return `${task.schedule.timeOfDay} · ${days}`;
}

function describeLastRun(task: ScheduledTask): string {
  if (!task.lastRun) return "Never run";
  const when = new Date(task.lastRun.at).toLocaleString();
  const detail = task.lastRun.detail ? ` — ${task.lastRun.detail}` : "";
  return `Last run ${when}: ${task.lastRun.outcome}${detail}`;
}

export function ScheduledTasksSettingsPanel() {
  const { environments } = useEnvironments();
  const projects = useProjects();
  const scheduled = useScheduledTasks();

  return (
    <SettingsPageContainer>
      <SettingsSection title="Scheduled tasks">
        <p className="px-1 text-xs text-muted-foreground">
          A scheduled task sends the same prompt to one or more provider accounts at a fixed time,
          using the clock of the environment that runs it. Each run is an ordinary thread that
          settles itself when the turn finishes, so it stays out of your chat list unless the agent
          needs you.
        </p>
        {environments.map((environment) => (
          <EnvironmentScheduledTasks
            environmentId={environment.environmentId}
            key={environment.environmentId}
            projects={projects
              .filter((project) => project.environmentId === environment.environmentId)
              .map((project) => ({ id: project.id, title: project.title }))}
            providerInstances={deriveProviderInstanceEntries(
              environment.serverConfig?.providers ?? [],
            )}
            scheduled={scheduled}
            title={environment.label}
          />
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function EnvironmentScheduledTasks({
  environmentId,
  projects,
  providerInstances,
  scheduled,
  title,
}: {
  environmentId: EnvironmentId;
  projects: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  providerInstances: ReturnType<typeof deriveProviderInstanceEntries>;
  scheduled: ReturnType<typeof useScheduledTasks>;
  title: string;
}) {
  const tasks = useMemo(
    () =>
      scheduled.environments.find((entry) => entry.environmentId === environmentId)?.tasks ?? [],
    [environmentId, scheduled.environments],
  );
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [busy, setBusy] = useState(false);

  const startNew = useCallback(() => {
    setDraft(emptyDraft(projects[0]?.id ?? ""));
  }, [projects]);

  const save = useCallback(async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const payload = {
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name.trim(),
        prompt: draft.prompt.trim(),
        projectId: draft.projectId,
        targets: draft.targets,
        schedule: { timeOfDay: draft.timeOfDay, daysOfWeek: draft.daysOfWeek },
        enabled: draft.enabled,
      } as ScheduledTaskDraft;
      await scheduled.save(environmentId, payload);
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }, [draft, environmentId, scheduled]);

  const canSave =
    draft !== null &&
    draft.name.trim().length > 0 &&
    draft.prompt.trim().length > 0 &&
    draft.projectId.length > 0 &&
    draft.targets.length > 0;

  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">{title}</h4>
        <Button onClick={startNew} size="sm" type="button" variant="outline">
          <PlusIcon className="size-3.5" /> New task
        </Button>
      </div>

      {tasks.length === 0 && draft === null ? (
        <p className="text-xs text-muted-foreground">No scheduled tasks on this environment.</p>
      ) : null}

      <ul className="space-y-2">
        {tasks.map((task) => (
          <li
            className="flex items-start justify-between gap-3 rounded-md border border-border/50 p-2"
            key={task.id}
          >
            <div className="min-w-0">
              <p className="truncate text-sm">
                {task.name}
                {task.enabled ? null : (
                  <span className="ml-2 text-[11px] text-muted-foreground">(disabled)</span>
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {describeSchedule(task)} · {task.targets.length} account
                {task.targets.length === 1 ? "" : "s"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground/80">
                {describeLastRun(task)} · Next{" "}
                {new Date(nextScheduledRunAt(task.schedule, Date.now())).toLocaleString()}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                aria-label={`Run ${task.name} now`}
                onClick={() => void scheduled.runNow(environmentId, task.id)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <PlayIcon className="size-3.5" />
              </Button>
              <Button
                onClick={() => setDraft(draftFromTask(task))}
                size="sm"
                type="button"
                variant="ghost"
              >
                Edit
              </Button>
              <Button
                aria-label={`Delete ${task.name}`}
                onClick={() => void scheduled.remove(environmentId, task.id)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {draft ? (
        <div className="space-y-3 rounded-md border border-border/60 bg-sidebar-accent/20 p-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Name</span>
            <Input
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="Open the morning window"
              value={draft.name}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Prompt</span>
            <Textarea
              onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
              placeholder="Say hello and summarize the repository."
              rows={3}
              value={draft.prompt}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Project</span>
            <select
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}
              value={draft.projectId}
            >
              <option value="">Select a project…</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">
              Accounts and models (this environment&apos;s configured providers)
            </span>
            <TargetPicker
              instances={providerInstances}
              onChange={(targets) => setDraft({ ...draft, targets })}
              targets={draft.targets}
            />
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">
                Time (environment&apos;s local clock)
              </span>
              <Input
                className="w-32"
                onChange={(event) => setDraft({ ...draft, timeOfDay: event.target.value })}
                type="time"
                value={draft.timeOfDay}
              />
            </label>

            <div className="space-y-1">
              <span className="block text-xs text-muted-foreground">
                Days (none selected = every day)
              </span>
              <div className="flex gap-1">
                {DAY_LABELS.map((label, day) => {
                  const selected = draft.daysOfWeek.includes(day);
                  return (
                    <Button
                      aria-pressed={selected}
                      key={label}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          daysOfWeek: selected
                            ? draft.daysOfWeek.filter((entry) => entry !== day)
                            : [...draft.daysOfWeek, day],
                        })
                      }
                      size="sm"
                      type="button"
                      variant={selected ? "default" : "outline"}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center gap-2">
              <Switch
                checked={draft.enabled}
                onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
              />
              <span className="text-xs text-muted-foreground">Enabled</span>
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button onClick={() => setDraft(null)} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={!canSave || busy} onClick={() => void save()} size="sm" type="button">
              {draft.id ? "Save task" : "Create task"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One row per configured provider instance: tick the accounts to send to, and
 * pick each one's model. Models are per account because running the same
 * prompt on two accounts usually means two different subscriptions.
 */
function TargetPicker({
  instances,
  onChange,
  targets,
}: {
  instances: ReturnType<typeof deriveProviderInstanceEntries>;
  onChange: (targets: ReadonlyArray<ScheduledTaskTarget>) => void;
  targets: ReadonlyArray<ScheduledTaskTarget>;
}) {
  const selected = new Map(targets.map((target) => [target.instanceId, target.model]));

  const toggle = (instanceId: ProviderInstanceId, models: ReadonlyArray<{ slug: string }>) => {
    if (selected.has(instanceId)) {
      onChange(targets.filter((target) => target.instanceId !== instanceId));
      return;
    }
    const model = models[0]?.slug;
    if (!model) return;
    onChange([...targets, { instanceId, model }]);
  };

  return (
    <ul className="space-y-1">
      {instances
        .filter((instance) => instance.enabled)
        .map((instance) => {
          const models = instance.models ?? [];
          const model = selected.get(instance.instanceId);
          return (
            <li className="flex items-center gap-2" key={instance.instanceId}>
              <input
                checked={model !== undefined}
                disabled={models.length === 0}
                onChange={() => toggle(instance.instanceId, models)}
                type="checkbox"
              />
              <span className="w-32 shrink-0 truncate text-xs">{instance.displayName}</span>
              <select
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
                disabled={model === undefined}
                onChange={(event) =>
                  onChange(
                    targets.map((target) =>
                      target.instanceId === instance.instanceId
                        ? { ...target, model: event.target.value }
                        : target,
                    ),
                  )
                }
                value={model ?? ""}
              >
                {models.length === 0 ? <option value="">No models reported</option> : null}
                {models.map((candidate) => (
                  <option key={candidate.slug} value={candidate.slug}>
                    {candidate.name || candidate.slug}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
    </ul>
  );
}
