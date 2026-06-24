/**
 * Backfills `provider_instance_id` for fork-only provider drivers so existing
 * rows resolve under the new instance-based routing model.
 *
 * Migrations 027/028 added the nullable `provider_instance_id` column to
 * `provider_session_runtime` and `projection_thread_sessions` but
 * intentionally left existing rows with `provider_instance_id IS NULL` —
 * the upstream PR couldn't safely guess which configured instance owned
 * each historical session for the four upstream drivers.
 *
 * For the fork's additional drivers (`amp`, `copilot`, `droid`, `geminiCli`, `kilo`),
 * the situation is simpler: every fork install runs at most one configured
 * instance per driver kind, so we can safely backfill
 * `provider_instance_id = '<driver_kind>'` (the default instance id used
 * by built-in single-instance drivers — see `defaultInstanceIdForDriver`)
 * for any row whose legacy `provider_name` matches one of the fork driver
 * kinds and whose `provider_instance_id` is still null.
 *
 * Idempotent — re-running the migration is a no-op on already-backfilled
 * rows because every UPDATE is guarded by `provider_instance_id IS NULL`.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const FORK_DRIVER_KINDS = ["amp", "copilot", "droid", "geminiCli", "kilo"] as const;

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  for (const driverKind of FORK_DRIVER_KINDS) {
    yield* sql`
      UPDATE provider_session_runtime
      SET provider_instance_id = ${driverKind}
      WHERE provider_name = ${driverKind}
        AND provider_instance_id IS NULL
    `;

    yield* sql`
      UPDATE projection_thread_sessions
      SET provider_instance_id = ${driverKind}
      WHERE provider_name = ${driverKind}
        AND provider_instance_id IS NULL
    `;
  }
});
