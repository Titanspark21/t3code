import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      task_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      schedule_json TEXT NOT NULL,
      project_id TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      max_retries INTEGER NOT NULL DEFAULT 2,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      next_run_at TEXT,
      last_run_at TEXT,
      last_run_status TEXT NOT NULL,
      last_run_error TEXT,
      run_count INTEGER NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_due
    ON scheduled_tasks(enabled, next_run_at)
    WHERE enabled = 1 AND next_run_at IS NOT NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_project
    ON scheduled_tasks(project_id, updated_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS scheduled_task_runs (
      run_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      scheduled_for TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      attempt_count INTEGER NOT NULL,
      thread_id TEXT,
      error TEXT,
      FOREIGN KEY(task_id) REFERENCES scheduled_tasks(task_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_task_started
    ON scheduled_task_runs(task_id, started_at DESC)
  `;
});
