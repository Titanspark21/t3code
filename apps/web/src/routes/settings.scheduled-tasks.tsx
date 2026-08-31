import { createFileRoute } from "@tanstack/react-router";

import { ScheduledTasksSettingsPanel } from "../components/settings/ScheduledTasksSettings";

function SettingsScheduledTasksRoute() {
  return <ScheduledTasksSettingsPanel />;
}

export const Route = createFileRoute("/settings/scheduled-tasks")({
  component: SettingsScheduledTasksRoute,
});
